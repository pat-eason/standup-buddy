package main

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

type Todo struct {
	ID          int64      `json:"id"`
	Title       string     `json:"title"`
	Description string     `json:"description"`
	ProjectID   *int64     `json:"projectId"`
	DueDate     *string    `json:"dueDate"`
	Done        bool       `json:"done"`
	CompletedAt *time.Time `json:"completedAt"`
	SourceDay   *string    `json:"sourceDay"`
	CreatedAt   time.Time  `json:"createdAt"`
}

const todoCols = `id, title, description, project_id, to_char(due_date, 'YYYY-MM-DD'), done, completed_at,
	to_char(source_day, 'YYYY-MM-DD'), created_at`

func scanTodo(row pgx.Row) (Todo, error) {
	var t Todo
	err := row.Scan(&t.ID, &t.Title, &t.Description, &t.ProjectID, &t.DueDate, &t.Done, &t.CompletedAt, &t.SourceDay, &t.CreatedAt)
	return t, err
}

func queryTodos(ctx context.Context, q dbtx, where string, args ...any) ([]Todo, error) {
	rows, err := q.Query(ctx, `SELECT `+todoCols+` FROM todos `+where, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Todo{}
	for rows.Next() {
		t, err := scanTodo(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

// ListTodos returns every open todo (soonest due first, undated last) followed by the
// todos completed in the last 14 days (newest first).
func (s *Store) ListTodos(ctx context.Context) ([]Todo, error) {
	open, err := queryTodos(ctx, s.pool, `WHERE NOT done ORDER BY due_date NULLS LAST, created_at, id`)
	if err != nil {
		return nil, err
	}
	done, err := queryTodos(ctx, s.pool,
		`WHERE done AND completed_at > now() - interval '14 days' ORDER BY completed_at DESC, id DESC`)
	if err != nil {
		return nil, err
	}
	return append(open, done...), nil
}

// TodosForDay returns todos created or completed on the given calendar day.
func (s *Store) TodosForDay(ctx context.Context, date string) (created, completed []Todo, err error) {
	if err = validDate(date); err != nil {
		return
	}
	const win = `$1::date AND %s < $1::date + 1`
	if created, err = queryTodos(ctx, s.pool,
		`WHERE created_at >= `+fmt.Sprintf(win, "created_at")+` ORDER BY created_at, id`, date); err != nil {
		return
	}
	completed, err = queryTodos(ctx, s.pool,
		`WHERE done AND completed_at >= `+fmt.Sprintf(win, "completed_at")+` ORDER BY completed_at, id`, date)
	return
}

type todoInput struct {
	Title       string  `json:"title"`
	Description string  `json:"description"`
	ProjectID   *int64  `json:"projectId"`
	DueDate     *string `json:"dueDate"`
	SourceDay   *string `json:"sourceDay"`
}

func cleanDate(d *string) (*string, error) {
	if d == nil || strings.TrimSpace(*d) == "" {
		return nil, nil
	}
	if err := validDate(*d); err != nil {
		return nil, err
	}
	return d, nil
}

func (s *Store) CreateTodo(ctx context.Context, in todoInput) (Todo, error) {
	title := clip(strings.TrimSpace(in.Title), 200)
	if title == "" {
		return Todo{}, bad("todo title is required")
	}
	due, err := cleanDate(in.DueDate)
	if err != nil {
		return Todo{}, err
	}
	src, err := cleanDate(in.SourceDay)
	if err != nil {
		return Todo{}, err
	}
	return scanTodo(s.pool.QueryRow(ctx, `INSERT INTO todos (title, description, project_id, due_date, source_day)
		VALUES ($1, $2, $3, $4::date, $5::date) RETURNING `+todoCols,
		title, strings.TrimSpace(in.Description), in.ProjectID, due, src))
}

// todoPatch uses explicit "clear" flags because null and absent look the same once decoded.
type todoPatch struct {
	Title        *string `json:"title"`
	Description  *string `json:"description"`
	ProjectID    *int64  `json:"projectId"`
	ClearProject bool    `json:"clearProject"`
	DueDate      *string `json:"dueDate"`
	ClearDue     bool    `json:"clearDueDate"`
	Done         *bool   `json:"done"`
}

func (s *Store) UpdateTodo(ctx context.Context, id int64, p todoPatch) (Todo, error) {
	if p.Title != nil && strings.TrimSpace(*p.Title) == "" {
		return Todo{}, bad("todo title is required")
	}
	due, err := cleanDate(p.DueDate)
	if err != nil {
		return Todo{}, err
	}
	var title *string
	if p.Title != nil {
		t := clip(strings.TrimSpace(*p.Title), 200)
		title = &t
	}
	t, err := scanTodo(s.pool.QueryRow(ctx, `UPDATE todos SET
			title = COALESCE($2, title),
			description = COALESCE($3, description),
			project_id = CASE WHEN $5 THEN NULL ELSE COALESCE($4, project_id) END,
			due_date = CASE WHEN $7 THEN NULL ELSE COALESCE($6::date, due_date) END,
			completed_at = CASE WHEN $8::boolean IS NULL THEN completed_at
				WHEN $8 AND NOT done THEN now() WHEN NOT $8 THEN NULL ELSE completed_at END,
			done = COALESCE($8, done),
			updated_at = now()
		WHERE id = $1 RETURNING `+todoCols,
		id, title, p.Description, p.ProjectID, p.ClearProject, due, p.ClearDue, p.Done))
	if errors.Is(err, pgx.ErrNoRows) {
		return t, errNotFound
	}
	return t, err
}

func (s *Store) DeleteTodo(ctx context.Context, id int64) error {
	_, err := s.pool.Exec(ctx, `DELETE FROM todos WHERE id = $1`, id)
	return err
}

// todoLine renders a todo for an LLM prompt.
func todoLine(t Todo, projectNames map[int64]string) string {
	var b strings.Builder
	b.WriteString("- " + t.Title)
	if t.ProjectID != nil && projectNames[*t.ProjectID] != "" {
		b.WriteString(" (" + projectNames[*t.ProjectID] + ")")
	}
	if t.DueDate != nil {
		b.WriteString(" [due " + *t.DueDate + "]")
	}
	if d := strings.Join(strings.Fields(t.Description), " "); d != "" {
		b.WriteString(": " + clip(d, 200))
	}
	return b.String()
}

// todoPromptSection lists the day's created and completed todos, or "" when there are none.
func (s *Server) todoPromptSection(ctx context.Context, date string, projectNames map[int64]string) (string, error) {
	created, completed, err := s.store.TodosForDay(ctx, date)
	if err != nil {
		return "", err
	}
	if len(created) == 0 && len(completed) == 0 {
		return "", nil
	}
	var b strings.Builder
	if len(completed) > 0 {
		b.WriteString("\nTodos completed today:\n")
		for _, t := range completed {
			b.WriteString(todoLine(t, projectNames) + "\n")
		}
	}
	if len(created) > 0 {
		b.WriteString("\nTodos created today:\n")
		for _, t := range created {
			state := ""
			if t.Done {
				state = " (already done)"
			}
			b.WriteString(todoLine(t, projectNames) + state + "\n")
		}
	}
	return b.String(), nil
}
