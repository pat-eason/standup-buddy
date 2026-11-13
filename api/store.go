package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var (
	errNotFound = errors.New("not found")
	dateRe      = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}$`)
	palette     = []string{"#ff5a5f", "#173b4f", "#4f9c7e", "#e0a93b", "#7567c9", "#3f93c2", "#c26a9b"}
	pointKinds  = map[string]bool{"update": true, "question": true, "decision": true, "parking": true}
)

type badRequest struct{ msg string }

func (e badRequest) Error() string { return e.msg }

func bad(format string, a ...any) error { return badRequest{fmt.Sprintf(format, a...)} }

func validDate(d string) error {
	if !dateRe.MatchString(d) {
		return bad("date must be YYYY-MM-DD")
	}
	if _, err := time.Parse("2006-01-02", d); err != nil {
		return bad("invalid date")
	}
	return nil
}

type Store struct{ pool *pgxpool.Pool }

func (s *Store) inTx(ctx context.Context, fn func(tx pgx.Tx) error) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	if err := fn(tx); err != nil {
		_ = tx.Rollback(ctx)
		return err
	}
	return tx.Commit(ctx)
}

// ---------------------------------------------------------------- projects

func (s *Store) ListProjects(ctx context.Context) ([]Project, error) {
	rows, err := s.pool.Query(ctx, `SELECT id, name, color, archived FROM projects ORDER BY archived, lower(name)`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Project{}
	for rows.Next() {
		var p Project
		if err := rows.Scan(&p.ID, &p.Name, &p.Color, &p.Archived); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

func (s *Store) CreateProject(ctx context.Context, name, color string) (Project, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return Project{}, bad("project name is required")
	}
	var p Project
	err := s.pool.QueryRow(ctx, `SELECT id, name, color, archived FROM projects WHERE lower(name) = lower($1)`, name).
		Scan(&p.ID, &p.Name, &p.Color, &p.Archived)
	if err == nil {
		return p, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return p, err
	}
	if color == "" {
		var n int
		if err := s.pool.QueryRow(ctx, `SELECT count(*) FROM projects`).Scan(&n); err != nil {
			return p, err
		}
		color = palette[n%len(palette)]
	}
	err = s.pool.QueryRow(ctx,
		`INSERT INTO projects (name, color) VALUES ($1, $2) RETURNING id, name, color, archived`, name, color).
		Scan(&p.ID, &p.Name, &p.Color, &p.Archived)
	return p, err
}

type projectPatch struct {
	Name     *string `json:"name"`
	Color    *string `json:"color"`
	Archived *bool   `json:"archived"`
}

func (s *Store) UpdateProject(ctx context.Context, id int64, p projectPatch) (Project, error) {
	var out Project
	err := s.pool.QueryRow(ctx, `UPDATE projects SET
			name = COALESCE(NULLIF(trim($2), ''), name),
			color = COALESCE($3, color),
			archived = COALESCE($4, archived)
		WHERE id = $1 RETURNING id, name, color, archived`,
		id, deref(p.Name), p.Color, p.Archived).
		Scan(&out.ID, &out.Name, &out.Color, &out.Archived)
	if errors.Is(err, pgx.ErrNoRows) {
		return out, errNotFound
	}
	return out, err
}

// clip truncates to n runes.
func clip(s string, n int) string {
	r := []rune(s)
	if len(r) <= n {
		return s
	}
	return string(r[:n])
}

func deref(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

func (s *Store) DeleteProject(ctx context.Context, id int64) error {
	_, err := s.pool.Exec(ctx, `DELETE FROM projects WHERE id = $1`, id)
	return err
}

// -------------------------------------------------------------------- days

func ensureDay(ctx context.Context, q dbtx, date string) error {
	_, err := q.Exec(ctx, `INSERT INTO days (date) VALUES ($1::date) ON CONFLICT (date) DO NOTHING`, date)
	return err
}

func touchDay(ctx context.Context, q dbtx, date string) error {
	_, err := q.Exec(ctx, `UPDATE days SET updated_at = now() WHERE date = $1::date`, date)
	return err
}

func (s *Store) GetDay(ctx context.Context, date string) (DayRecord, error) {
	return getDay(ctx, s.pool, date)
}

func getDay(ctx context.Context, q dbtx, date string) (DayRecord, error) {
	if err := validDate(date); err != nil {
		return DayRecord{}, err
	}
	d := DayRecord{Date: date, Status: "open", Entries: []StreamEntry{}, Points: []Point{}}
	var fin []byte
	err := q.QueryRow(ctx,
		`SELECT status, general_notes, collated_at, finalized_at, finalized FROM days WHERE date = $1::date`, date).
		Scan(&d.Status, &d.GeneralNotes, &d.CollatedAt, &d.FinalizedAt, &fin)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return d, err
	}
	if len(fin) > 0 {
		var f Finalization
		if json.Unmarshal(fin, &f) == nil {
			normalizeFinal(&f)
			d.Finalization = &f
		}
	}

	rows, err := q.Query(ctx, `SELECT e.id, e.text, e.created_at,
			COALESCE((SELECT array_agg(project_id ORDER BY project_id) FROM entry_projects WHERE entry_id = e.id), '{}')
		FROM stream_entries e WHERE e.day = $1::date ORDER BY e.created_at, e.id`, date)
	if err != nil {
		return d, err
	}
	for rows.Next() {
		e := StreamEntry{Day: date}
		if err := rows.Scan(&e.ID, &e.Text, &e.CreatedAt, &e.ProjectIDs); err != nil {
			rows.Close()
			return d, err
		}
		d.Entries = append(d.Entries, e)
	}
	rows.Close()

	rows, err = q.Query(ctx, `SELECT p.id, p.kind, p.text, p.position, p.origin, p.edited, p.discussed, p.group_label, p.rationale, p.source_entry_ids,
			COALESCE((SELECT array_agg(project_id ORDER BY project_id) FROM point_projects WHERE point_id = p.id), '{}')
		FROM points p WHERE p.day = $1::date ORDER BY p.position, p.id`, date)
	if err != nil {
		return d, err
	}
	index := map[int64]int{}
	for rows.Next() {
		p := Point{Day: date, Notes: []PointNote{}}
		if err := rows.Scan(&p.ID, &p.Kind, &p.Text, &p.Position, &p.Origin, &p.Edited, &p.Discussed, &p.Group, &p.Rationale, &p.SourceEntryIDs, &p.ProjectIDs); err != nil {
			rows.Close()
			return d, err
		}
		index[p.ID] = len(d.Points)
		d.Points = append(d.Points, p)
	}
	rows.Close()

	rows, err = q.Query(ctx, `SELECT n.id, n.point_id, n.text, n.created_at FROM point_notes n
		JOIN points p ON p.id = n.point_id WHERE p.day = $1::date ORDER BY n.created_at, n.id`, date)
	if err != nil {
		return d, err
	}
	defer rows.Close()
	for rows.Next() {
		var n PointNote
		if err := rows.Scan(&n.ID, &n.PointID, &n.Text, &n.CreatedAt); err != nil {
			return d, err
		}
		if i, ok := index[n.PointID]; ok {
			d.Points[i].Notes = append(d.Points[i].Notes, n)
		}
	}
	return d, rows.Err()
}

func normalizeFinal(f *Finalization) {
	if f.Decisions == nil {
		f.Decisions = []string{}
	}
	if f.ActionItems == nil {
		f.ActionItems = []ActionItem{}
	}
	if f.FollowUps == nil {
		f.FollowUps = []string{}
	}
	if f.CarryOver == nil {
		f.CarryOver = []string{}
	}
	if f.SuggestedTodos == nil {
		f.SuggestedTodos = []SuggestedTodo{}
	}
}

func (s *Store) ListDays(ctx context.Context) ([]DaySummary, error) {
	rows, err := s.pool.Query(ctx, `SELECT to_char(d.date, 'YYYY-MM-DD'), d.status, d.finalized->>'headline',
			(SELECT count(*) FROM stream_entries e WHERE e.day = d.date),
			(SELECT count(*) FROM points p WHERE p.day = d.date),
			(SELECT count(*) FROM point_notes n JOIN points p ON p.id = n.point_id WHERE p.day = d.date)
		FROM days d ORDER BY d.date DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []DaySummary{}
	for rows.Next() {
		var d DaySummary
		if err := rows.Scan(&d.Date, &d.Status, &d.Headline, &d.EntryCount, &d.PointCount, &d.NoteCount); err != nil {
			return nil, err
		}
		if d.EntryCount > 0 || d.PointCount > 0 || d.Status != "open" {
			out = append(out, d)
		}
	}
	return out, rows.Err()
}

func (s *Store) SetGeneralNotes(ctx context.Context, date, text string) error {
	if err := validDate(date); err != nil {
		return err
	}
	return s.inTx(ctx, func(tx pgx.Tx) error {
		if err := ensureDay(ctx, tx, date); err != nil {
			return err
		}
		_, err := tx.Exec(ctx, `UPDATE days SET general_notes = $2, updated_at = now() WHERE date = $1::date`, date, text)
		return err
	})
}

func (s *Store) ReopenDay(ctx context.Context, date string) error {
	if err := validDate(date); err != nil {
		return err
	}
	_, err := s.pool.Exec(ctx, `UPDATE days SET status = CASE WHEN collated_at IS NULL THEN 'open' ELSE 'collated' END,
		updated_at = now() WHERE date = $1::date`, date)
	return err
}

func (s *Store) SaveFinalization(ctx context.Context, date string, f Finalization) error {
	normalizeFinal(&f)
	raw, _ := json.Marshal(f)
	_, err := s.pool.Exec(ctx, `UPDATE days SET status = 'finalized', finalized_at = now(), finalized = $2::jsonb,
		updated_at = now() WHERE date = $1::date`, date, string(raw))
	return err
}

// ----------------------------------------------------------------- entries

func setLinks(ctx context.Context, q dbtx, table, col string, id int64, projectIDs []int64) error {
	if _, err := q.Exec(ctx, fmt.Sprintf(`DELETE FROM %s WHERE %s = $1`, table, col), id); err != nil {
		return err
	}
	if len(projectIDs) == 0 {
		return nil
	}
	_, err := q.Exec(ctx, fmt.Sprintf(`INSERT INTO %s (%s, project_id)
		SELECT $1, p.id FROM projects p WHERE p.id = ANY($2) ON CONFLICT DO NOTHING`, table, col), id, projectIDs)
	return err
}

func (s *Store) AddEntry(ctx context.Context, date, text string, projectIDs []int64) (DayRecord, error) {
	text = strings.TrimSpace(text)
	if err := validDate(date); err != nil {
		return DayRecord{}, err
	}
	if text == "" {
		return DayRecord{}, bad("entry is empty")
	}
	err := s.inTx(ctx, func(tx pgx.Tx) error {
		if err := ensureDay(ctx, tx, date); err != nil {
			return err
		}
		var id int64
		if err := tx.QueryRow(ctx, `INSERT INTO stream_entries (day, text) VALUES ($1::date, $2) RETURNING id`, date, text).Scan(&id); err != nil {
			return err
		}
		if err := setLinks(ctx, tx, "entry_projects", "entry_id", id, projectIDs); err != nil {
			return err
		}
		return touchDay(ctx, tx, date)
	})
	if err != nil {
		return DayRecord{}, err
	}
	return s.GetDay(ctx, date)
}

func (s *Store) UpdateEntry(ctx context.Context, id int64, text string, projectIDs []int64) error {
	text = strings.TrimSpace(text)
	if text == "" {
		return bad("entry is empty")
	}
	return s.inTx(ctx, func(tx pgx.Tx) error {
		tag, err := tx.Exec(ctx, `UPDATE stream_entries SET text = $2, updated_at = now() WHERE id = $1`, id, text)
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			return errNotFound
		}
		return setLinks(ctx, tx, "entry_projects", "entry_id", id, projectIDs)
	})
}

func (s *Store) DeleteEntry(ctx context.Context, id int64) error {
	_, err := s.pool.Exec(ctx, `DELETE FROM stream_entries WHERE id = $1`, id)
	return err
}

// ------------------------------------------------------------------ points

func (s *Store) AddPoint(ctx context.Context, date, kind, text string, projectIDs []int64) error {
	text = strings.TrimSpace(text)
	if err := validDate(date); err != nil {
		return err
	}
	if !pointKinds[kind] {
		return bad("kind must be update, question, decision or parking")
	}
	if text == "" {
		return bad("point is empty")
	}
	return s.inTx(ctx, func(tx pgx.Tx) error {
		if err := ensureDay(ctx, tx, date); err != nil {
			return err
		}
		var id int64
		err := tx.QueryRow(ctx, `INSERT INTO points (day, kind, text, position, origin)
			VALUES ($1::date, $2, $3, (SELECT COALESCE(MAX(position), 0) + 1 FROM points WHERE day = $1::date), 'manual')
			RETURNING id`, date, kind, text).Scan(&id)
		if err != nil {
			return err
		}
		if err := setLinks(ctx, tx, "point_projects", "point_id", id, projectIDs); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `UPDATE days SET status = CASE WHEN status = 'open' THEN 'collated' ELSE status END,
			updated_at = now() WHERE date = $1::date`, date); err != nil {
			return err
		}
		return nil
	})
}

type pointPatch struct {
	Text       *string  `json:"text"`
	Kind       *string  `json:"kind"`
	ProjectIDs *[]int64 `json:"projectIds"`
	Discussed  *bool    `json:"discussed"`
	Group      *string  `json:"group"`
	Rationale  *string  `json:"rationale"`
}

func (s *Store) UpdatePoint(ctx context.Context, id int64, p pointPatch) error {
	if p.Kind != nil && !pointKinds[*p.Kind] {
		return bad("invalid kind")
	}
	return s.inTx(ctx, func(tx pgx.Tx) error {
		var curText, curKind string
		if err := tx.QueryRow(ctx, `SELECT text, kind FROM points WHERE id = $1 FOR UPDATE`, id).Scan(&curText, &curKind); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return errNotFound
			}
			return err
		}
		newText := curText
		if p.Text != nil && strings.TrimSpace(*p.Text) != "" {
			newText = strings.TrimSpace(*p.Text)
		}
		newKind := curKind
		if p.Kind != nil {
			newKind = *p.Kind
		}
		changed := newText != curText || newKind != curKind || p.ProjectIDs != nil || p.Group != nil || p.Rationale != nil
		var group, rationale *string
		if p.Group != nil {
			g := clip(strings.TrimSpace(*p.Group), 60)
			group = &g
		}
		if p.Rationale != nil {
			r := strings.TrimSpace(*p.Rationale)
			rationale = &r
		}
		if _, err := tx.Exec(ctx, `UPDATE points SET text = $2, kind = $3, discussed = COALESCE($4, discussed),
			group_label = COALESCE($6, group_label), rationale = COALESCE($7, rationale),
			edited = edited OR $5, updated_at = now() WHERE id = $1`, id, newText, newKind, p.Discussed, changed, group, rationale); err != nil {
			return err
		}
		if p.ProjectIDs != nil {
			return setLinks(ctx, tx, "point_projects", "point_id", id, *p.ProjectIDs)
		}
		return nil
	})
}

func (s *Store) DeletePoint(ctx context.Context, id int64) error {
	_, err := s.pool.Exec(ctx, `DELETE FROM points WHERE id = $1`, id)
	return err
}

type collatedPoint struct {
	Kind           string
	Text           string
	Group          string
	Rationale      string
	ProjectIDs     []int64
	SourceEntryIDs []int64
}

// ApplyCollation replaces the AI-generated board. Points the user touched
// (edited, discussed, annotated or manually added) survive a re-collation.
func (s *Store) ApplyCollation(ctx context.Context, date string, points []collatedPoint) error {
	return s.inTx(ctx, func(tx pgx.Tx) error {
		if err := ensureDay(ctx, tx, date); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `DELETE FROM points WHERE day = $1::date AND origin = 'ai' AND NOT edited AND NOT discussed
			AND NOT EXISTS (SELECT 1 FROM point_notes n WHERE n.point_id = points.id)`, date); err != nil {
			return err
		}
		var pos int
		if err := tx.QueryRow(ctx, `SELECT COALESCE(MAX(position), 0) FROM points WHERE day = $1::date`, date).Scan(&pos); err != nil {
			return err
		}
		for _, p := range points {
			pos++
			if p.SourceEntryIDs == nil {
				p.SourceEntryIDs = []int64{}
			}
			var id int64
			if err := tx.QueryRow(ctx, `INSERT INTO points (day, kind, text, group_label, rationale, position, origin, source_entry_ids)
				VALUES ($1::date, $2, $3, $4, $5, $6, 'ai', $7) RETURNING id`,
				date, p.Kind, p.Text, p.Group, p.Rationale, pos, p.SourceEntryIDs).Scan(&id); err != nil {
				return err
			}
			if err := setLinks(ctx, tx, "point_projects", "point_id", id, p.ProjectIDs); err != nil {
				return err
			}
		}
		_, err := tx.Exec(ctx, `UPDATE days SET status = 'collated', collated_at = now(), updated_at = now() WHERE date = $1::date`, date)
		return err
	})
}

// ------------------------------------------------------------------- notes

func (s *Store) AddNote(ctx context.Context, pointID int64, text string) error {
	text = strings.TrimSpace(text)
	if text == "" {
		return bad("note is empty")
	}
	return s.inTx(ctx, func(tx pgx.Tx) error {
		var day string
		if err := tx.QueryRow(ctx, `SELECT to_char(day, 'YYYY-MM-DD') FROM points WHERE id = $1`, pointID).Scan(&day); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return errNotFound
			}
			return err
		}
		if _, err := tx.Exec(ctx, `INSERT INTO point_notes (point_id, text) VALUES ($1, $2)`, pointID, text); err != nil {
			return err
		}
		return touchDay(ctx, tx, day)
	})
}

func (s *Store) UpdateNote(ctx context.Context, id int64, text string) error {
	text = strings.TrimSpace(text)
	if text == "" {
		return bad("note is empty")
	}
	_, err := s.pool.Exec(ctx, `UPDATE point_notes SET text = $2, updated_at = now() WHERE id = $1`, id, text)
	return err
}

func (s *Store) DeleteNote(ctx context.Context, id int64) error {
	_, err := s.pool.Exec(ctx, `DELETE FROM point_notes WHERE id = $1`, id)
	return err
}

// ------------------------------------------------------------------ search

type searchOptions struct {
	Query, From, To, Project string
	Limit                    int
}

type scoredHit struct {
	SearchHit
	score float64
}

func tokenize(q string) []string {
	out := []string{}
	for _, t := range strings.Fields(strings.ToLower(q)) {
		t = strings.NewReplacer("%", "", "_", "", `\`, "").Replace(t)
		if len(t) > 1 {
			out = append(out, t)
		}
	}
	return out
}

func scoreText(text string, tokens []string) float64 {
	if len(tokens) == 0 {
		return 1
	}
	lower := strings.ToLower(text)
	n := 0.0
	for _, t := range tokens {
		if strings.Contains(lower, t) {
			n++
		}
	}
	return n
}

func nullIfEmpty(s string) any {
	if s == "" {
		return nil
	}
	return s
}

func (s *Store) Search(ctx context.Context, o searchOptions) ([]SearchHit, error) {
	if o.Limit <= 0 {
		o.Limit = 12
	}
	tokens := tokenize(o.Query)
	patterns := make([]string, len(tokens))
	for i, t := range tokens {
		patterns[i] = "%" + t + "%"
	}
	from, to := nullIfEmpty(o.From), nullIfEmpty(o.To)
	for _, v := range []string{o.From, o.To} {
		if v != "" {
			if err := validDate(v); err != nil {
				return nil, err
			}
		}
	}
	hits := []scoredHit{}
	names := func(ids []int64, byID map[int64]string) []string {
		out := []string{}
		for _, id := range ids {
			if n := byID[id]; n != "" {
				out = append(out, n)
			}
		}
		return out
	}
	projects, err := s.ListProjects(ctx)
	if err != nil {
		return nil, err
	}
	byID := map[int64]string{}
	for _, p := range projects {
		byID[p.ID] = p.Name
	}

	// stream entries
	rows, err := s.pool.Query(ctx, `SELECT to_char(e.day, 'YYYY-MM-DD'), e.text, e.created_at,
			COALESCE((SELECT array_agg(project_id) FROM entry_projects WHERE entry_id = e.id), '{}')
		FROM stream_entries e
		WHERE (cardinality($1::text[]) = 0 OR e.text ILIKE ANY($1))
		  AND ($2::date IS NULL OR e.day >= $2::date) AND ($3::date IS NULL OR e.day <= $3::date)
		ORDER BY e.day DESC LIMIT 300`, patterns, from, to)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var h SearchHit
		var ids []int64
		h.Type = "stream"
		if err := rows.Scan(&h.Day, &h.Text, &h.At, &ids); err != nil {
			rows.Close()
			return nil, err
		}
		h.Projects = names(ids, byID)
		hits = append(hits, scoredHit{h, scoreText(h.Text, tokens)})
	}
	rows.Close()

	// points
	rows, err = s.pool.Query(ctx, `SELECT to_char(p.day, 'YYYY-MM-DD'), p.kind, p.text, p.rationale, p.created_at,
			COALESCE((SELECT array_agg(project_id) FROM point_projects WHERE point_id = p.id), '{}')
		FROM points p
		WHERE (cardinality($1::text[]) = 0 OR p.text ILIKE ANY($1) OR p.rationale ILIKE ANY($1))
		  AND ($2::date IS NULL OR p.day >= $2::date) AND ($3::date IS NULL OR p.day <= $3::date)
		ORDER BY p.day DESC LIMIT 300`, patterns, from, to)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var h SearchHit
		var ids []int64
		var why string
		h.Type = "point"
		if err := rows.Scan(&h.Day, &h.Kind, &h.Text, &why, &h.At, &ids); err != nil {
			rows.Close()
			return nil, err
		}
		h.Projects = names(ids, byID)
		sc := scoreText(h.Text+" "+why, tokens) + 0.2
		if why != "" {
			h.Text += "  (why: " + why + ")"
		}
		hits = append(hits, scoredHit{h, sc})
	}
	rows.Close()

	// discussion notes
	rows, err = s.pool.Query(ctx, `SELECT to_char(p.day, 'YYYY-MM-DD'), p.kind, n.text, p.text, n.created_at
		FROM point_notes n JOIN points p ON p.id = n.point_id
		WHERE (cardinality($1::text[]) = 0 OR n.text ILIKE ANY($1))
		  AND ($2::date IS NULL OR p.day >= $2::date) AND ($3::date IS NULL OR p.day <= $3::date)
		ORDER BY p.day DESC LIMIT 300`, patterns, from, to)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var h SearchHit
		var pointText string
		h.Type = "note"
		if err := rows.Scan(&h.Day, &h.Kind, &h.Text, &pointText, &h.At); err != nil {
			rows.Close()
			return nil, err
		}
		h.Projects = []string{}
		sc := scoreText(h.Text, tokens) + 0.3
		h.Text = fmt.Sprintf("%s  (on: %s)", h.Text, pointText)
		hits = append(hits, scoredHit{h, sc})
	}
	rows.Close()

	// meeting notes + finalized summaries
	rows, err = s.pool.Query(ctx, `SELECT to_char(date, 'YYYY-MM-DD'), general_notes, finalized, updated_at FROM days
		WHERE (general_notes <> '' OR finalized IS NOT NULL)
		  AND ($1::date IS NULL OR date >= $1::date) AND ($2::date IS NULL OR date <= $2::date)
		ORDER BY date DESC LIMIT 300`, from, to)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var day, notes string
		var fin []byte
		var at time.Time
		if err := rows.Scan(&day, &notes, &fin, &at); err != nil {
			rows.Close()
			return nil, err
		}
		if notes != "" && len(tokens) > 0 {
			if sc := scoreText(notes, tokens); sc > 0 {
				hits = append(hits, scoredHit{SearchHit{Day: day, Type: "general_notes", Text: notes, Projects: []string{}, At: at}, sc})
			}
		}
		var f Finalization
		if len(fin) > 0 && json.Unmarshal(fin, &f) == nil {
			blob := strings.Join(append(append([]string{f.Headline, f.Summary}, f.Decisions...), f.FollowUps...), "\n")
			for _, a := range f.ActionItems {
				blob += "\n" + a.Text
			}
			if sc := scoreText(blob, tokens); sc > 0 {
				hits = append(hits, scoredHit{SearchHit{Day: day, Type: "summary", Text: f.Headline + " — " + f.Summary, Projects: []string{}, At: at}, sc})
			}
		}
	}
	rows.Close()

	if w := strings.ToLower(strings.TrimSpace(o.Project)); w != "" {
		filtered := hits[:0]
		for _, h := range hits {
			for _, p := range h.Projects {
				if strings.Contains(strings.ToLower(p), w) {
					filtered = append(filtered, h)
					break
				}
			}
		}
		hits = filtered
	}
	sort.SliceStable(hits, func(i, j int) bool {
		if hits[i].score != hits[j].score {
			return hits[i].score > hits[j].score
		}
		return hits[i].Day > hits[j].Day
	})
	if len(hits) > o.Limit {
		hits = hits[:o.Limit]
	}
	out := make([]SearchHit, len(hits))
	for i, h := range hits {
		if h.Projects == nil {
			h.Projects = []string{}
		}
		out[i] = h.SearchHit
	}
	return out, nil
}

// ------------------------------------------------------------------ threads

func (s *Store) ListThreads(ctx context.Context) ([]ChatThread, error) {
	rows, err := s.pool.Query(ctx, `SELECT id::text, title, created_at, updated_at FROM chat_threads ORDER BY updated_at DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []ChatThread{}
	for rows.Next() {
		var t ChatThread
		if err := rows.Scan(&t.ID, &t.Title, &t.CreatedAt, &t.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

func (s *Store) CreateThread(ctx context.Context) (ChatThread, error) {
	var t ChatThread
	err := s.pool.QueryRow(ctx, `INSERT INTO chat_threads DEFAULT VALUES RETURNING id::text, title, created_at, updated_at`).
		Scan(&t.ID, &t.Title, &t.CreatedAt, &t.UpdatedAt)
	return t, err
}

func (s *Store) TouchThread(ctx context.Context, id string, title *string) error {
	tag, err := s.pool.Exec(ctx, `UPDATE chat_threads SET title = COALESCE(NULLIF(trim($2), ''), title), updated_at = now() WHERE id = $1::uuid`, id, title)
	if err == nil && tag.RowsAffected() == 0 {
		return errNotFound
	}
	return err
}

func (s *Store) DeleteThread(ctx context.Context, id string) error {
	_, err := s.pool.Exec(ctx, `DELETE FROM chat_threads WHERE id = $1::uuid`, id)
	return err
}

func (s *Store) ClearThreads(ctx context.Context) error {
	_, err := s.pool.Exec(ctx, `DELETE FROM chat_threads`)
	return err
}
