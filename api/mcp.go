package main

import (
	"context"
	"crypto/subtle"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"strings"
	"time"
	_ "time/tzdata" // so TZ=America/New_York works in the minimal runtime image

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// MCP server, mounted at /mcp. Tools call the store and jobs directly.
// Stateless, so restarting the API never strands a client session.

var pointKindList = []string{"update", "question", "decision", "parking"}

func today() string { return time.Now().Format("2006-01-02") }

func orToday(d string) string {
	if d == "" {
		return today()
	}
	return d
}

// toolErr turns store errors into messages the model can act on, without leaking internals.
func toolErr(err error) error {
	var br badRequest
	var ae agentError
	switch {
	case err == nil:
		return nil
	case errors.As(err, &br), errors.As(err, &ae), errors.Is(err, errNotFound):
		return err
	default:
		slog.Error("mcp tool failed", "error", err)
		return errors.New("internal error")
	}
}

// out wraps a tool result: handlers return objects (not bare arrays) so clients get valid structured output.
func out[T any](v T, err error) (*mcp.CallToolResult, T, error) { return nil, v, toolErr(err) }

type dateArg struct {
	Date string `json:"date,omitempty" jsonschema:"YYYY-MM-DD; defaults to today"`
}

type rangeArg struct {
	Date string `json:"date,omitempty" jsonschema:"a single day, YYYY-MM-DD"`
	From string `json:"from,omitempty" jsonschema:"start of a range (inclusive); use with 'to'"`
	To   string `json:"to,omitempty" jsonschema:"end of a range (inclusive); defaults to today"`
}

// days resolves date / from-to to the recorded days inside it (newest first); no args means today.
func (s *Server) mcpDays(ctx context.Context, a rangeArg) ([]string, error) {
	if a.Date != "" {
		return []string{a.Date}, validDate(a.Date)
	}
	if a.From == "" && a.To == "" {
		return []string{today()}, nil
	}
	to := a.To
	if to == "" {
		to = today()
	}
	from := a.From
	if from == "" {
		t, err := time.Parse("2006-01-02", to)
		if err != nil {
			return nil, bad("invalid 'to' date")
		}
		from = t.AddDate(0, 0, -6).Format("2006-01-02")
	}
	if err := validDate(from); err != nil {
		return nil, err
	}
	if err := validDate(to); err != nil {
		return nil, err
	}
	all, err := s.store.ListDays(ctx)
	if err != nil {
		return nil, err
	}
	var days []string
	for _, d := range all {
		if d.Date >= from && d.Date <= to {
			days = append(days, d.Date)
		}
	}
	return days, nil
}

type dayStatus struct {
	Date               string         `json:"date"`
	IsToday            bool           `json:"isToday"`
	Status             string         `json:"status"`
	CollatedAt         *time.Time     `json:"collatedAt"`
	FinalizedAt        *time.Time     `json:"finalizedAt"`
	StreamEntries      int            `json:"streamEntries"`
	StandupItems       int            `json:"standupItems"`
	StandupItemsByKind map[string]int `json:"standupItemsByKind"`
	DiscussedItems     int            `json:"discussedItems"`
	ItemNotes          int            `json:"itemNotes"`
	HasMeetingNotes    bool           `json:"hasMeetingNotes"`
	Headline           string         `json:"headline,omitempty"`
	OpenTodos          int            `json:"openTodos"`
}

type streamDay struct {
	Date    string        `json:"date"`
	Entries []StreamEntry `json:"entries"`
}
type itemsDay struct {
	Date         string  `json:"date"`
	Status       string  `json:"status"`
	GeneralNotes string  `json:"generalNotes"`
	Items        []Point `json:"items"`
}
type summaryDay struct {
	Date        string        `json:"date"`
	Status      string        `json:"status"`
	FinalizedAt *time.Time    `json:"finalizedAt"`
	Summary     *Finalization `json:"summary"`
}

type addEntryArg struct {
	Text       string  `json:"text" jsonschema:"the note"`
	Date       string  `json:"date,omitempty" jsonschema:"YYYY-MM-DD; defaults to today"`
	ProjectIDs []int64 `json:"projectIds,omitempty" jsonschema:"project ids from list_projects"`
}
type addItemArg struct {
	Text       string  `json:"text"`
	Kind       string  `json:"kind,omitempty" jsonschema:"update, question, decision or parking; defaults to update"`
	Date       string  `json:"date,omitempty" jsonschema:"YYYY-MM-DD; defaults to today"`
	ProjectIDs []int64 `json:"projectIds,omitempty"`
}
type addNoteArg struct {
	ItemID int64  `json:"itemId" jsonschema:"standup item id from get_standup_items"`
	Text   string `json:"text"`
}
type addTodoArg struct {
	Title       string  `json:"title" jsonschema:"up to 200 characters"`
	Description string  `json:"description,omitempty"`
	ProjectID   *int64  `json:"projectId,omitempty" jsonschema:"from list_projects"`
	DueDate     *string `json:"dueDate,omitempty" jsonschema:"YYYY-MM-DD"`
	Urgency     *int    `json:"urgency,omitempty" jsonschema:"1 (not urgent, the default) to 5 (incredibly urgent)"`
}
type listTodosArg struct {
	IncludeDone bool `json:"includeDone,omitempty" jsonschema:"also return completed todos"`
}
type deleteTodoArg struct {
	ID int64 `json:"id"`
}

func (s *Server) newMCPServer() *mcp.Server {
	srv := mcp.NewServer(&mcp.Implementation{Name: "standup-buddy", Version: "1.0.0"}, nil)

	mcp.AddTool(srv, &mcp.Tool{
		Name: "get_day_status",
		Description: "Status of a day (default today): open, collated or finalized; counts of stream entries, standup items " +
			"(by kind), discussed items and notes; plus the open todo count. Use this first to see what to do next.",
	}, func(ctx context.Context, _ *mcp.CallToolRequest, a dateArg) (*mcp.CallToolResult, dayStatus, error) {
		date := orToday(a.Date)
		if err := validDate(date); err != nil {
			return out(dayStatus{}, err)
		}
		day, err := s.store.GetDay(ctx, date)
		if err != nil {
			return out(dayStatus{}, err)
		}
		todos, err := s.store.ListTodos(ctx)
		if err != nil {
			return out(dayStatus{}, err)
		}
		st := dayStatus{
			Date: day.Date, IsToday: day.Date == today(), Status: day.Status,
			CollatedAt: day.CollatedAt, FinalizedAt: day.FinalizedAt,
			StreamEntries: len(day.Entries), StandupItems: len(day.Points),
			StandupItemsByKind: map[string]int{}, HasMeetingNotes: strings.TrimSpace(day.GeneralNotes) != "",
		}
		for _, k := range pointKindList {
			st.StandupItemsByKind[k] = 0
		}
		for _, p := range day.Points {
			st.StandupItemsByKind[p.Kind]++
			st.ItemNotes += len(p.Notes)
			if p.Discussed {
				st.DiscussedItems++
			}
		}
		if day.Finalization != nil {
			st.Headline = day.Finalization.Headline
		}
		for _, t := range todos {
			if !t.Done {
				st.OpenTodos++
			}
		}
		return out(st, nil)
	})

	mcp.AddTool(srv, &mcp.Tool{
		Name:        "list_projects",
		Description: "Projects you can tag stream entries, standup items and todos with. Returns ids and names.",
	}, func(ctx context.Context, _ *mcp.CallToolRequest, _ struct{}) (*mcp.CallToolResult, struct {
		Projects []Project `json:"projects"`
	}, error) {
		all, err := s.store.ListProjects(ctx)
		res := struct {
			Projects []Project `json:"projects"`
		}{Projects: []Project{}}
		for _, p := range all {
			if !p.Archived {
				res.Projects = append(res.Projects, p)
			}
		}
		return out(res, err)
	})

	mcp.AddTool(srv, &mcp.Tool{
		Name:        "add_stream_entry",
		Description: "Add a stream-of-consciousness entry to a day's stream (default today). Entries are what a collation turns into standup items.",
	}, func(ctx context.Context, _ *mcp.CallToolRequest, a addEntryArg) (*mcp.CallToolResult, StreamEntry, error) {
		date := orToday(a.Date)
		day, err := s.store.AddEntry(ctx, date, a.Text, a.ProjectIDs)
		if err != nil {
			return out(StreamEntry{}, err)
		}
		if n := len(day.Entries); n > 0 {
			return out(day.Entries[n-1], nil) // entries are ordered oldest first
		}
		return out(StreamEntry{}, nil)
	})

	mcp.AddTool(srv, &mcp.Tool{
		Name: "add_standup_item",
		Description: "Add a standup item directly to a day's board (default today) without collating. " +
			"Kinds: update, question, decision, parking. A later collation keeps items you add.",
	}, func(ctx context.Context, _ *mcp.CallToolRequest, a addItemArg) (*mcp.CallToolResult, Point, error) {
		date, kind := orToday(a.Date), a.Kind
		if kind == "" {
			kind = "update"
		}
		if err := s.store.AddPoint(ctx, date, kind, a.Text, a.ProjectIDs); err != nil {
			return out(Point{}, err)
		}
		day, err := s.store.GetDay(ctx, date)
		if err != nil {
			return out(Point{}, err)
		}
		want := strings.TrimSpace(a.Text)
		for i := len(day.Points) - 1; i >= 0; i-- {
			if day.Points[i].Text == want {
				return out(day.Points[i], nil)
			}
		}
		return out(Point{}, nil)
	})

	mcp.AddTool(srv, &mcp.Tool{
		Name: "collate_day",
		Description: "Run the LLM collation for a day (default today): turns the stream into standup items. Can take a minute or two. " +
			"Items you edited, checked off or added are kept. Needs an Anthropic API key in Settings.",
	}, func(ctx context.Context, _ *mcp.CallToolRequest, a dateArg) (*mcp.CallToolResult, struct {
		Date         string     `json:"date"`
		Status       string     `json:"status"`
		CollatedAt   *time.Time `json:"collatedAt"`
		StandupItems []Point    `json:"standupItems"`
	}, error) {
		type result = struct {
			Date         string     `json:"date"`
			Status       string     `json:"status"`
			CollatedAt   *time.Time `json:"collatedAt"`
			StandupItems []Point    `json:"standupItems"`
		}
		day, err := s.runDayJob(ctx, "collate", orToday(a.Date), s.collateDay)
		if err != nil {
			return out(result{}, err)
		}
		return out(result{day.Date, day.Status, day.CollatedAt, day.Points}, nil)
	})

	mcp.AddTool(srv, &mcp.Tool{
		Name:        "add_item_note",
		Description: "Add a timestamped discussion note to a standup item. Get item ids from get_standup_items.",
	}, func(ctx context.Context, _ *mcp.CallToolRequest, a addNoteArg) (*mcp.CallToolResult, struct {
		OK     bool  `json:"ok"`
		ItemID int64 `json:"itemId"`
	}, error) {
		type result = struct {
			OK     bool  `json:"ok"`
			ItemID int64 `json:"itemId"`
		}
		if err := s.store.AddNote(ctx, a.ItemID, a.Text); err != nil {
			return out(result{}, err)
		}
		return out(result{true, a.ItemID}, nil)
	})

	mcp.AddTool(srv, &mcp.Tool{
		Name: "finalize_standup",
		Description: "Finalize a day (default today): the LLM folds the items and notes into a summary with decisions, action items, " +
			"follow-ups, carry-over and suggested todos. Can take a minute or two. Needs an Anthropic API key in Settings.",
	}, func(ctx context.Context, _ *mcp.CallToolRequest, a dateArg) (*mcp.CallToolResult, summaryDay, error) {
		day, err := s.runDayJob(ctx, "finalize", orToday(a.Date), s.finalizeDay)
		if err != nil {
			return out(summaryDay{}, err)
		}
		return out(summaryDay{day.Date, day.Status, day.FinalizedAt, day.Finalization}, nil)
	})

	mcp.AddTool(srv, &mcp.Tool{Name: "add_todo", Description: "Create a todo. Optionally set urgency from 1 (not urgent) to 5 (incredibly urgent)."},
		func(ctx context.Context, _ *mcp.CallToolRequest, a addTodoArg) (*mcp.CallToolResult, Todo, error) {
			return out(s.store.CreateTodo(ctx, todoInput{Title: a.Title, Description: a.Description, ProjectID: a.ProjectID, DueDate: a.DueDate, Urgency: a.Urgency, Source: "mcp"}))
		})

	mcp.AddTool(srv, &mcp.Tool{
		Name:        "list_todos",
		Description: "Todos (open ones unless includeDone is set). Use to find an id for delete_todo.",
	}, func(ctx context.Context, _ *mcp.CallToolRequest, a listTodosArg) (*mcp.CallToolResult, struct {
		Todos []Todo `json:"todos"`
	}, error) {
		all, err := s.store.ListTodos(ctx)
		res := struct {
			Todos []Todo `json:"todos"`
		}{Todos: []Todo{}}
		for _, t := range all {
			if a.IncludeDone || !t.Done {
				res.Todos = append(res.Todos, t)
			}
		}
		return out(res, err)
	})

	mcp.AddTool(srv, &mcp.Tool{Name: "delete_todo", Description: "Permanently delete a todo by id. Cannot be undone."},
		func(ctx context.Context, _ *mcp.CallToolRequest, a deleteTodoArg) (*mcp.CallToolResult, struct {
			OK      bool  `json:"ok"`
			Deleted int64 `json:"deleted"`
		}, error) {
			err := s.store.DeleteTodo(ctx, a.ID)
			return out(struct {
				OK      bool  `json:"ok"`
				Deleted int64 `json:"deleted"`
			}{err == nil, a.ID}, err)
		})

	mcp.AddTool(srv, &mcp.Tool{
		Name:        "get_stream_items",
		Description: "Stream entries by day. Give date, or from/to for a range of recorded days; with neither, returns today.",
	}, func(ctx context.Context, _ *mcp.CallToolRequest, a rangeArg) (*mcp.CallToolResult, struct {
		Days []streamDay `json:"days"`
	}, error) {
		res := struct {
			Days []streamDay `json:"days"`
		}{Days: []streamDay{}}
		err := s.eachDay(ctx, a, func(d DayRecord) { res.Days = append(res.Days, streamDay{d.Date, d.Entries}) })
		return out(res, err)
	})

	mcp.AddTool(srv, &mcp.Tool{
		Name: "get_standup_items",
		Description: "Standup items (updates, questions, decisions, parking lot) with their discussion notes and the meeting notepad, by day. " +
			"Give date, or from/to for a range; with neither, returns today.",
	}, func(ctx context.Context, _ *mcp.CallToolRequest, a rangeArg) (*mcp.CallToolResult, struct {
		Days []itemsDay `json:"days"`
	}, error) {
		res := struct {
			Days []itemsDay `json:"days"`
		}{Days: []itemsDay{}}
		err := s.eachDay(ctx, a, func(d DayRecord) {
			res.Days = append(res.Days, itemsDay{d.Date, d.Status, d.GeneralNotes, d.Points})
		})
		return out(res, err)
	})

	mcp.AddTool(srv, &mcp.Tool{
		Name: "get_standup_summaries",
		Description: "Finalized standup summaries by day (summary is null when a day is not finalized). " +
			"Give date, or from/to for a range; with neither, returns today.",
	}, func(ctx context.Context, _ *mcp.CallToolRequest, a rangeArg) (*mcp.CallToolResult, struct {
		Days []summaryDay `json:"days"`
	}, error) {
		res := struct {
			Days []summaryDay `json:"days"`
		}{Days: []summaryDay{}}
		err := s.eachDay(ctx, a, func(d DayRecord) {
			res.Days = append(res.Days, summaryDay{d.Date, d.Status, d.FinalizedAt, d.Finalization})
		})
		return out(res, err)
	})

	return srv
}

func (s *Server) eachDay(ctx context.Context, a rangeArg, fn func(DayRecord)) error {
	days, err := s.mcpDays(ctx, a)
	if err != nil {
		return err
	}
	for _, d := range days {
		rec, err := s.store.GetDay(ctx, d)
		if err != nil {
			return err
		}
		fn(rec)
	}
	return nil
}

// mcpHandler serves /mcp. MCP_TOKEN, when set, is required as a bearer token.
func (s *Server) mcpHandler() http.Handler {
	srv := s.newMCPServer()
	h := mcp.NewStreamableHTTPHandler(func(*http.Request) *mcp.Server { return srv },
		&mcp.StreamableHTTPOptions{Stateless: true, JSONResponse: true})
	token := os.Getenv("MCP_TOKEN")
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if token != "" {
			given := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
			if subtle.ConstantTimeCompare([]byte(given), []byte(token)) != 1 {
				writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
				return
			}
		}
		h.ServeHTTP(w, r)
	})
}
