package main

import (
	"context"
	"os"
	"strings"
	"testing"
	"time"
)

// Integration test: needs a disposable Postgres, e.g. TEST_DATABASE_URL=postgres://standup:standup@localhost:5432/standup.
func TestTodosForDayAndPrompt(t *testing.T) {
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Skip("TEST_DATABASE_URL not set")
	}
	ctx := context.Background()
	pool, err := connect(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	if _, _, err := migrate(ctx, pool); err != nil {
		t.Fatal(err)
	}
	store := &Store{pool: pool}
	srv := &Server{store: store}

	today := time.Now().Format("2006-01-02")
	made, err := store.CreateTodo(ctx, todoInput{Title: "prompt-test created", DueDate: &today})
	if err != nil {
		t.Fatal(err)
	}
	finished, _ := store.CreateTodo(ctx, todoInput{Title: "prompt-test finished"})
	done := true
	if _, err := store.UpdateTodo(ctx, finished.ID, todoPatch{Done: &done}); err != nil {
		t.Fatal(err)
	}
	defer store.DeleteTodo(ctx, made.ID)
	defer store.DeleteTodo(ctx, finished.ID)

	section, err := srv.todoPromptSection(ctx, today, map[int64]string{})
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{"Todos completed today:", "prompt-test finished", "Todos created today:", "prompt-test created [due " + today + "]"} {
		if !strings.Contains(section, want) {
			t.Errorf("prompt section missing %q:\n%s", want, section)
		}
	}
	if old, err := srv.todoPromptSection(ctx, "2020-01-01", nil); err != nil || old != "" {
		t.Errorf("expected empty section for an old day, got %q (%v)", old, err)
	}
}

func TestTodoUrgency(t *testing.T) {
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Skip("TEST_DATABASE_URL not set")
	}
	ctx := context.Background()
	pool, err := connect(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	if _, _, err := migrate(ctx, pool); err != nil {
		t.Fatal(err)
	}
	store := &Store{pool: pool}

	plain, err := store.CreateTodo(ctx, todoInput{Title: "urgency-test default"})
	if err != nil {
		t.Fatal(err)
	}
	defer store.DeleteTodo(ctx, plain.ID)
	if plain.Urgency != 1 {
		t.Errorf("default urgency = %d, want 1", plain.Urgency)
	}

	five := 5
	hot, err := store.CreateTodo(ctx, todoInput{Title: "urgency-test hot", Urgency: &five})
	if err != nil {
		t.Fatal(err)
	}
	defer store.DeleteTodo(ctx, hot.ID)
	if hot.Urgency != 5 {
		t.Errorf("urgency = %d, want 5", hot.Urgency)
	}

	// An update that does not mention urgency leaves it alone; one that does changes it.
	title := "urgency-test hot renamed"
	if got, err := store.UpdateTodo(ctx, hot.ID, todoPatch{Title: &title}); err != nil || got.Urgency != 5 {
		t.Errorf("rename: urgency = %d, err = %v; want 5, nil", got.Urgency, err)
	}
	three := 3
	if got, err := store.UpdateTodo(ctx, hot.ID, todoPatch{Urgency: &three}); err != nil || got.Urgency != 3 {
		t.Errorf("patch: urgency = %d, err = %v; want 3, nil", got.Urgency, err)
	}

	for _, n := range []int{0, 6, -1} {
		n := n
		if _, err := store.CreateTodo(ctx, todoInput{Title: "urgency-test bad", Urgency: &n}); err == nil {
			t.Errorf("create with urgency %d should fail", n)
		}
		if _, err := store.UpdateTodo(ctx, hot.ID, todoPatch{Urgency: &n}); err == nil {
			t.Errorf("update to urgency %d should fail", n)
		}
	}
}
