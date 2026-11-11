package main

import (
	"context"
	"fmt"
	"strings"
)

func (s *Server) dayMarkdown(ctx context.Context, date string) (string, error) {
	d, err := s.store.GetDay(ctx, date)
	if err != nil {
		return "", err
	}
	projects, err := s.store.ListProjects(ctx)
	if err != nil {
		return "", err
	}
	names := map[int64]string{}
	for _, p := range projects {
		names[p.ID] = p.Name
	}
	tag := func(ids []int64) string {
		parts := []string{}
		for _, id := range ids {
			if n := names[id]; n != "" {
				parts = append(parts, n)
			}
		}
		if len(parts) == 0 {
			return ""
		}
		return " _(" + strings.Join(parts, ", ") + ")_"
	}

	var b strings.Builder
	fmt.Fprintf(&b, "# Standup — %s\n\n", date)
	if d.Finalization != nil {
		fmt.Fprintf(&b, "**%s**\n\n%s\n\n", d.Finalization.Headline, d.Finalization.Summary)
	}
	sections := []struct{ title, kind string }{
		{"Updates", "update"}, {"Outstanding questions", "question"}, {"Decision points", "decision"}, {"Parking lot", "parking"},
	}
	for _, sec := range sections {
		wrote := false
		for _, p := range d.Points {
			if p.Kind != sec.kind {
				continue
			}
			if !wrote {
				fmt.Fprintf(&b, "## %s\n\n", sec.title)
				wrote = true
			}
			fmt.Fprintf(&b, "- %s%s\n", p.Text, tag(p.ProjectIDs))
			for _, n := range p.Notes {
				fmt.Fprintf(&b, "  - Note: %s\n", n.Text)
			}
		}
		if wrote {
			b.WriteString("\n")
		}
	}
	if f := d.Finalization; f != nil {
		list := func(title string, items []string) {
			if len(items) == 0 {
				return
			}
			fmt.Fprintf(&b, "## %s\n\n", title)
			for _, it := range items {
				fmt.Fprintf(&b, "- %s\n", it)
			}
			b.WriteString("\n")
		}
		list("Decisions made", f.Decisions)
		actions := []string{}
		for _, a := range f.ActionItems {
			if a.Owner != "" {
				actions = append(actions, a.Text+" — "+a.Owner)
			} else {
				actions = append(actions, a.Text)
			}
		}
		list("Action items", actions)
		list("Follow-ups", f.FollowUps)
		list("Carry over", f.CarryOver)
	}
	if n := strings.TrimSpace(d.GeneralNotes); n != "" {
		fmt.Fprintf(&b, "## Meeting notes\n\n%s\n", n)
	}
	return strings.TrimSpace(b.String()) + "\n", nil
}
