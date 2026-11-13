package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

const (
	dateLayout = "2006-01-02"
	// A change smaller than this share of the earlier half is reported as flat.
	flatTrendBand = 0.15
	maxRangeDays  = 92
)

// ------------------------------------------------------------------- types

type Totals struct {
	Entries    int `json:"entries"`
	Updates    int `json:"updates"`
	Questions  int `json:"questions"`
	Decisions  int `json:"decisions"`
	Parking    int `json:"parking"`
	Discussed  int `json:"discussed"`
	Notes      int `json:"notes"`
	ActiveDays int `json:"activeDays"`
}

type DayMetrics struct {
	Date      string `json:"date"`
	Entries   int    `json:"entries"`
	Updates   int    `json:"updates"`
	Questions int    `json:"questions"`
	Decisions int    `json:"decisions"`
	Parking   int    `json:"parking"`
	Discussed int    `json:"discussed"`
	Notes     int    `json:"notes"`
	// DeltaUpdates is the change in accomplished items versus the previous
	// active day in the range; nil for the first active day and for idle days.
	DeltaUpdates *int `json:"deltaUpdates"`
}

type Trend struct {
	// Direction is up, down, flat or insufficient (fewer than two active days).
	Direction string `json:"direction"`
	// ChangePct compares average accomplished per active day, second half vs first half.
	ChangePct *float64 `json:"changePct"`
}

type ProjectActivity struct {
	ProjectID *int64 `json:"projectId"` // nil for work not tagged to a project
	Name      string `json:"name"`
	Color     string `json:"color"`
	Entries   int    `json:"entries"`
	Updates   int    `json:"updates"`
	Questions int    `json:"questions"`
	Decisions int    `json:"decisions"`
	Parking   int    `json:"parking"`
	Total     int    `json:"total"`
}

type MetricsReport struct {
	From     string            `json:"from"`
	To       string            `json:"to"`
	Days     []DayMetrics      `json:"days"`
	Totals   Totals            `json:"totals"`
	Previous Totals            `json:"previous"` // the equally long range just before From
	Trend    Trend             `json:"trend"`
	Projects []ProjectActivity `json:"projects"`
}

// WeeklyRecap maps onto a SWOT matrix: successes = strengths, misses = weaknesses,
// opportunities = opportunities, threats = risks to what comes next.
type WeeklyRecap struct {
	Headline      string    `json:"headline"`
	Summary       string    `json:"summary"`
	Successes     []string  `json:"successes"`
	Misses        []string  `json:"misses"`
	Opportunities []string  `json:"opportunities"`
	Threats       []string  `json:"threats"`
	GeneratedAt   time.Time `json:"generatedAt"`
}

type WeekReport struct {
	WeekStart string        `json:"weekStart"`
	WeekEnd   string        `json:"weekEnd"`
	Metrics   MetricsReport `json:"metrics"`
	Recap     *WeeklyRecap  `json:"recap"`
}

// ------------------------------------------------------------------ metrics

func parseRange(from, to string) (time.Time, time.Time, error) {
	if err := validDate(from); err != nil {
		return time.Time{}, time.Time{}, err
	}
	if err := validDate(to); err != nil {
		return time.Time{}, time.Time{}, err
	}
	f, _ := time.Parse(dateLayout, from)
	t, _ := time.Parse(dateLayout, to)
	if t.Before(f) {
		return f, t, bad("'to' must not be before 'from'")
	}
	if t.Sub(f) > maxRangeDays*24*time.Hour {
		return f, t, bad("range is limited to %d days", maxRangeDays)
	}
	return f, t, nil
}

// weekBounds snaps any date to its Monday..Sunday week.
func weekBounds(date string) (time.Time, time.Time, error) {
	if err := validDate(date); err != nil {
		return time.Time{}, time.Time{}, err
	}
	d, _ := time.Parse(dateLayout, date)
	offset := (int(d.Weekday()) + 6) % 7
	start := d.AddDate(0, 0, -offset)
	return start, start.AddDate(0, 0, 6), nil
}

func (s *Store) dailyMetrics(ctx context.Context, from, to string) ([]DayMetrics, error) {
	rows, err := s.pool.Query(ctx, `SELECT to_char(g.d, 'YYYY-MM-DD'),
			(SELECT count(*) FROM stream_entries e WHERE e.day = g.d),
			(SELECT count(*) FROM points p WHERE p.day = g.d AND p.kind = 'update'),
			(SELECT count(*) FROM points p WHERE p.day = g.d AND p.kind = 'question'),
			(SELECT count(*) FROM points p WHERE p.day = g.d AND p.kind = 'decision'),
			(SELECT count(*) FROM points p WHERE p.day = g.d AND p.kind = 'parking'),
			(SELECT count(*) FROM points p WHERE p.day = g.d AND p.discussed),
			(SELECT count(*) FROM point_notes n JOIN points p ON p.id = n.point_id WHERE p.day = g.d)
		FROM (SELECT d::date AS d FROM generate_series($1::date, $2::date, interval '1 day') d) g
		ORDER BY g.d`, from, to)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []DayMetrics{}
	var lastActive *DayMetrics
	for rows.Next() {
		var d DayMetrics
		if err := rows.Scan(&d.Date, &d.Entries, &d.Updates, &d.Questions, &d.Decisions, &d.Parking, &d.Discussed, &d.Notes); err != nil {
			return nil, err
		}
		// Compare with the previous day that had activity, so a skipped day or a
		// weekend does not read as a drop to zero followed by a jump.
		if d.active() && lastActive != nil {
			delta := d.Updates - lastActive.Updates
			d.DeltaUpdates = &delta
		}
		out = append(out, d)
		if d.active() {
			lastActive = &out[len(out)-1]
		}
	}
	return out, rows.Err()
}

func (d DayMetrics) active() bool {
	return d.Entries+d.Updates+d.Questions+d.Decisions+d.Parking > 0
}

func sumDays(days []DayMetrics) Totals {
	var t Totals
	for _, d := range days {
		t.Entries += d.Entries
		t.Updates += d.Updates
		t.Questions += d.Questions
		t.Decisions += d.Decisions
		t.Parking += d.Parking
		t.Discussed += d.Discussed
		t.Notes += d.Notes
		if d.active() {
			t.ActiveDays++
		}
	}
	return t
}

// computeTrend compares average accomplished items per active day between the
// first and second half of the range. Days with no activity are ignored so a
// weekend does not read as a decline.
func computeTrend(days []DayMetrics) Trend {
	var active []DayMetrics
	for _, d := range days {
		if d.active() {
			active = append(active, d)
		}
	}
	if len(active) < 2 {
		return Trend{Direction: "insufficient"}
	}
	mid := len(active) / 2
	avg := func(ds []DayMetrics) float64 {
		sum := 0
		for _, d := range ds {
			sum += d.Updates
		}
		return float64(sum) / float64(len(ds))
	}
	first, second := avg(active[:mid]), avg(active[mid:])
	if first == 0 {
		if second == 0 {
			return Trend{Direction: "flat"}
		}
		return Trend{Direction: "up"}
	}
	change := (second - first) / first
	pct := change * 100
	switch {
	case change > flatTrendBand:
		return Trend{Direction: "up", ChangePct: &pct}
	case change < -flatTrendBand:
		return Trend{Direction: "down", ChangePct: &pct}
	default:
		return Trend{Direction: "flat", ChangePct: &pct}
	}
}

func (s *Store) projectActivity(ctx context.Context, from, to string) ([]ProjectActivity, error) {
	rows, err := s.pool.Query(ctx, `SELECT pr.id, pr.name, pr.color, pr.archived,
			(SELECT count(*) FROM entry_projects ep JOIN stream_entries e ON e.id = ep.entry_id
				WHERE ep.project_id = pr.id AND e.day BETWEEN $1::date AND $2::date),
			(SELECT count(*) FROM point_projects pp JOIN points p ON p.id = pp.point_id
				WHERE pp.project_id = pr.id AND p.kind = 'update' AND p.day BETWEEN $1::date AND $2::date),
			(SELECT count(*) FROM point_projects pp JOIN points p ON p.id = pp.point_id
				WHERE pp.project_id = pr.id AND p.kind = 'question' AND p.day BETWEEN $1::date AND $2::date),
			(SELECT count(*) FROM point_projects pp JOIN points p ON p.id = pp.point_id
				WHERE pp.project_id = pr.id AND p.kind = 'decision' AND p.day BETWEEN $1::date AND $2::date),
			(SELECT count(*) FROM point_projects pp JOIN points p ON p.id = pp.point_id
				WHERE pp.project_id = pr.id AND p.kind = 'parking' AND p.day BETWEEN $1::date AND $2::date)
		FROM projects pr ORDER BY lower(pr.name)`, from, to)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []ProjectActivity{}
	for rows.Next() {
		var a ProjectActivity
		var id int64
		var archived bool
		if err := rows.Scan(&id, &a.Name, &a.Color, &archived, &a.Entries, &a.Updates, &a.Questions, &a.Decisions, &a.Parking); err != nil {
			return nil, err
		}
		a.ProjectID = &id
		a.Total = a.Entries + a.Updates + a.Questions + a.Decisions + a.Parking
		if a.Total > 0 {
			out = append(out, a)
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	rows.Close()

	// Work that was not tagged to any project.
	u := ProjectActivity{Name: "Untagged", Color: "#9aa7b0"}
	err = s.pool.QueryRow(ctx, `SELECT
			(SELECT count(*) FROM stream_entries e WHERE e.day BETWEEN $1::date AND $2::date
				AND NOT EXISTS (SELECT 1 FROM entry_projects ep WHERE ep.entry_id = e.id)),
			count(*) FILTER (WHERE p.kind = 'update'),
			count(*) FILTER (WHERE p.kind = 'question'),
			count(*) FILTER (WHERE p.kind = 'decision'),
			count(*) FILTER (WHERE p.kind = 'parking')
		FROM points p WHERE p.day BETWEEN $1::date AND $2::date
			AND NOT EXISTS (SELECT 1 FROM point_projects pp WHERE pp.point_id = p.id)`, from, to).
		Scan(&u.Entries, &u.Updates, &u.Questions, &u.Decisions, &u.Parking)
	if err != nil {
		return nil, err
	}
	u.Total = u.Entries + u.Updates + u.Questions + u.Decisions + u.Parking
	if u.Total > 0 {
		out = append(out, u)
	}
	sortProjects(out)
	return out, nil
}

func sortProjects(p []ProjectActivity) {
	for i := 1; i < len(p); i++ {
		for j := i; j > 0 && p[j].Total > p[j-1].Total; j-- {
			p[j], p[j-1] = p[j-1], p[j]
		}
	}
}

func (s *Store) Metrics(ctx context.Context, from, to string) (MetricsReport, error) {
	f, t, err := parseRange(from, to)
	if err != nil {
		return MetricsReport{}, err
	}
	days, err := s.dailyMetrics(ctx, from, to)
	if err != nil {
		return MetricsReport{}, err
	}
	span := int(t.Sub(f).Hours()/24) + 1
	prevFrom := f.AddDate(0, 0, -span).Format(dateLayout)
	prevTo := f.AddDate(0, 0, -1).Format(dateLayout)
	prevDays, err := s.dailyMetrics(ctx, prevFrom, prevTo)
	if err != nil {
		return MetricsReport{}, err
	}
	projects, err := s.projectActivity(ctx, from, to)
	if err != nil {
		return MetricsReport{}, err
	}
	return MetricsReport{
		From: from, To: to, Days: days, Totals: sumDays(days), Previous: sumDays(prevDays),
		Trend: computeTrend(days), Projects: projects,
	}, nil
}

// ------------------------------------------------------------------- recaps

func (s *Store) GetRecap(ctx context.Context, weekStart string) (*WeeklyRecap, error) {
	var raw []byte
	var at time.Time
	err := s.pool.QueryRow(ctx, `SELECT content, generated_at FROM weekly_recaps WHERE week_start = $1::date`, weekStart).Scan(&raw, &at)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var r WeeklyRecap
	if err := json.Unmarshal(raw, &r); err != nil {
		return nil, nil
	}
	r.GeneratedAt = at
	normalizeRecap(&r)
	return &r, nil
}

func (s *Store) SaveRecap(ctx context.Context, weekStart string, r WeeklyRecap) error {
	normalizeRecap(&r)
	raw, _ := json.Marshal(r)
	_, err := s.pool.Exec(ctx, `INSERT INTO weekly_recaps (week_start, content) VALUES ($1::date, $2::jsonb)
		ON CONFLICT (week_start) DO UPDATE SET content = EXCLUDED.content, generated_at = now()`, weekStart, string(raw))
	return err
}

func normalizeRecap(r *WeeklyRecap) {
	for _, l := range []*[]string{&r.Successes, &r.Misses, &r.Opportunities, &r.Threats} {
		if *l == nil {
			*l = []string{}
		}
	}
}

func (s *Store) WeekReport(ctx context.Context, date string) (WeekReport, error) {
	start, end, err := weekBounds(date)
	if err != nil {
		return WeekReport{}, err
	}
	from, to := start.Format(dateLayout), end.Format(dateLayout)
	m, err := s.Metrics(ctx, from, to)
	if err != nil {
		return WeekReport{}, err
	}
	recap, err := s.GetRecap(ctx, from)
	if err != nil {
		return WeekReport{}, err
	}
	return WeekReport{WeekStart: from, WeekEnd: to, Metrics: m, Recap: recap}, nil
}

// recapWeek asks the agent to write the weekly recap from the week's finalized
// summaries (or raw boards for days that were never finalized) plus the metrics.
func (s *Server) recapWeek(ctx context.Context, date string) error {
	if err := s.requireKey(ctx); err != nil {
		return err
	}
	start, end, err := weekBounds(date)
	if err != nil {
		return err
	}
	from, to := start.Format(dateLayout), end.Format(dateLayout)
	metrics, err := s.store.Metrics(ctx, from, to)
	if err != nil {
		return err
	}
	if metrics.Totals.ActiveDays == 0 {
		return bad("no standup activity recorded for the week of %s", from)
	}
	projects, err := s.store.ListProjects(ctx)
	if err != nil {
		return err
	}
	nameByID := map[int64]string{}
	for _, p := range projects {
		nameByID[p.ID] = p.Name
	}

	var b strings.Builder
	fmt.Fprintf(&b, "Week: %s to %s\n\nMetrics for the week (previous week in brackets):\n", from, to)
	t, p := metrics.Totals, metrics.Previous
	fmt.Fprintf(&b, "- updates (accomplished): %d [%d]\n- open questions: %d [%d]\n- decisions needed: %d [%d]\n- parking lot: %d [%d]\n- active days: %d [%d]\n",
		t.Updates, p.Updates, t.Questions, p.Questions, t.Decisions, p.Decisions, t.Parking, p.Parking, t.ActiveDays, p.ActiveDays)
	fmt.Fprintf(&b, "- accomplished trend across the week: %s\n", metrics.Trend.Direction)
	if len(metrics.Projects) > 0 {
		b.WriteString("\nActivity per project (updates / questions / decisions / parking):\n")
		for _, a := range metrics.Projects {
			fmt.Fprintf(&b, "- %s: %d / %d / %d / %d\n", a.Name, a.Updates, a.Questions, a.Decisions, a.Parking)
		}
	}

	for _, dm := range metrics.Days {
		if !dm.active() {
			continue
		}
		day, err := s.store.GetDay(ctx, dm.Date)
		if err != nil {
			return err
		}
		fmt.Fprintf(&b, "\n## %s\n", dm.Date)
		if f := day.Finalization; f != nil {
			fmt.Fprintf(&b, "Headline: %s\n%s\n", f.Headline, f.Summary)
			writeList(&b, "Decisions made", f.Decisions)
			writeList(&b, "Follow-ups", f.FollowUps)
			writeList(&b, "Carried over", f.CarryOver)
			continue
		}
		for _, pt := range day.Points {
			tags := []string{}
			for _, id := range pt.ProjectIDs {
				tags = append(tags, nameByID[id])
			}
			tag := ""
			if len(tags) > 0 {
				tag = " (" + strings.Join(tags, ", ") + ")"
			}
			fmt.Fprintf(&b, "- [%s]%s %s\n", pt.Kind, tag, pt.Text)
		}
	}
	b.WriteString("\nWrite the weekly recap and call submit_recap.")

	raw, err := s.agent.Run(ctx, "recap", fmt.Sprintf("recap-%s-%d", from, time.Now().UnixMilli()), clip(b.String(), 60000))
	if err != nil {
		return err
	}
	var r WeeklyRecap
	if err := json.Unmarshal(raw, &r); err != nil {
		return agentError{"could not read the model's result: " + err.Error()}
	}
	if strings.TrimSpace(r.Headline) == "" && strings.TrimSpace(r.Summary) == "" {
		return errors.New("the model returned an empty recap")
	}
	return s.store.SaveRecap(ctx, from, r)
}

func writeList(b *strings.Builder, label string, items []string) {
	if len(items) == 0 {
		return
	}
	fmt.Fprintf(b, "%s:\n", label)
	for _, it := range items {
		fmt.Fprintf(b, "- %s\n", it)
	}
}

// ------------------------------------------------------------------- routes

func (s *Server) insightRoutes(mux *http.ServeMux) {
	h := s.handle
	mux.HandleFunc("GET /api/metrics", h(func(r *http.Request) (any, error) {
		q := r.URL.Query()
		return s.store.Metrics(r.Context(), q.Get("from"), q.Get("to"))
	}))
	mux.HandleFunc("GET /api/weeks/{date}", h(func(r *http.Request) (any, error) {
		return s.store.WeekReport(r.Context(), r.PathValue("date"))
	}))
	mux.HandleFunc("POST /api/weeks/{date}/recap", h(func(r *http.Request) (any, error) {
		date := r.PathValue("date")
		start, _, err := weekBounds(date)
		if err != nil {
			return nil, err
		}
		key := "recap:" + start.Format(dateLayout)
		if _, busy := s.inflight.LoadOrStore(key, struct{}{}); busy {
			return nil, bad("a recap is already being written for this week")
		}
		defer s.inflight.Delete(key)
		// Detach from client disconnects so a finished LLM call is still saved.
		ctx, cancel := context.WithTimeout(context.WithoutCancel(r.Context()), 4*time.Minute)
		defer cancel()
		if err := s.recapWeek(ctx, date); err != nil {
			return nil, err
		}
		return s.store.WeekReport(ctx, date)
	}))
}
