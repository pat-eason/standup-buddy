package main

import (
	"encoding/json"
	"testing"
)

func TestChatPartsFold(t *testing.T) {
	var c chatParts
	for _, e := range []chatEvent{
		{Type: "text", Delta: "Let me "},
		{Type: "text", Delta: "look."},
		{Type: "tool", ID: "t1", Name: "search_notes", Input: json.RawMessage(`{"query":"checkout"}`), State: "running"},
		{Type: "tool", ID: "t1", State: "done"},
		{Type: "tool", ID: "t2", Name: "get_day", State: "running"}, // never reports back
		{Type: "text", Delta: "  "},
		{Type: "text", Delta: "Found it."},
	} {
		c.apply(e)
	}
	got := c.final()
	if len(got) != 4 {
		t.Fatalf("want 4 parts, got %d: %+v", len(got), got)
	}
	if got[0].Text != "Let me look." {
		t.Errorf("first text part = %q", got[0].Text)
	}
	if got[1].State != "done" || got[1].Name != "search_notes" {
		t.Errorf("tool t1 = %+v", got[1])
	}
	if got[2].State != "done" {
		t.Errorf("a tool that never reported should settle as done, got %q", got[2].State)
	}
	if got[3].Text != "  Found it." {
		t.Errorf("text after a tool starts a new part, got %q", got[3].Text)
	}
}

func TestChatPartsDropsBlankText(t *testing.T) {
	var c chatParts
	c.apply(chatEvent{Type: "text", Delta: "   "})
	if got := c.final(); len(got) != 0 {
		t.Fatalf("blank text should be dropped, got %+v", got)
	}
}
