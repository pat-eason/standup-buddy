package main

import (
	"encoding/json"
	"time"
)

type Project struct {
	ID       int64  `json:"id"`
	Name     string `json:"name"`
	Color    string `json:"color"`
	Archived bool   `json:"archived"`
}

type StreamEntry struct {
	ID         int64     `json:"id"`
	Day        string    `json:"day"`
	Text       string    `json:"text"`
	CreatedAt  time.Time `json:"createdAt"`
	ProjectIDs []int64   `json:"projectIds"`
}

type PointNote struct {
	ID        int64     `json:"id"`
	PointID   int64     `json:"pointId"`
	Text      string    `json:"text"`
	CreatedAt time.Time `json:"createdAt"`
}

type Point struct {
	ID             int64       `json:"id"`
	Day            string      `json:"day"`
	Kind           string      `json:"kind"`
	Text           string      `json:"text"`
	Position       int         `json:"position"`
	Origin         string      `json:"origin"`
	Edited         bool        `json:"edited"`
	Discussed      bool        `json:"discussed"`
	Group          string      `json:"group"`
	Rationale      string      `json:"rationale"`
	ProjectIDs     []int64     `json:"projectIds"`
	SourceEntryIDs []int64     `json:"sourceEntryIds"`
	Notes          []PointNote `json:"notes"`
}

type ActionItem struct {
	Text  string `json:"text"`
	Owner string `json:"owner,omitempty"`
}

type Finalization struct {
	Headline    string       `json:"headline"`
	Summary     string       `json:"summary"`
	Decisions   []string     `json:"decisions"`
	ActionItems []ActionItem `json:"actionItems"`
	FollowUps   []string     `json:"followUps"`
	CarryOver   []string     `json:"carryOver"`
}

type DayRecord struct {
	Date         string        `json:"date"`
	Status       string        `json:"status"`
	GeneralNotes string        `json:"generalNotes"`
	CollatedAt   *time.Time    `json:"collatedAt"`
	FinalizedAt  *time.Time    `json:"finalizedAt"`
	Finalization *Finalization `json:"finalization"`
	Entries      []StreamEntry `json:"entries"`
	Points       []Point       `json:"points"`
}

type DaySummary struct {
	Date       string  `json:"date"`
	Status     string  `json:"status"`
	EntryCount int     `json:"entryCount"`
	PointCount int     `json:"pointCount"`
	NoteCount  int     `json:"noteCount"`
	Headline   *string `json:"headline"`
}

type SearchHit struct {
	Day      string    `json:"day"`
	Type     string    `json:"type"`
	Kind     string    `json:"kind,omitempty"`
	Text     string    `json:"text"`
	Projects []string  `json:"projects"`
	At       time.Time `json:"at"`
}

type ChatThread struct {
	ID        string    `json:"id"`
	Title     string    `json:"title"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

// Settings are what the UI edits. The API key is stored separately and never returned.
type Settings struct {
	CollateModel         string `json:"collateModel"`
	FinalizeModel        string `json:"finalizeModel"`
	ChatModel            string `json:"chatModel"`
	ThinkingLevel        string `json:"thinkingLevel"`
	UserContext          string `json:"userContext"`
	CollateInstructions  string `json:"collateInstructions"`
	FinalizeInstructions string `json:"finalizeInstructions"`
	ToolSearchNotes      bool   `json:"toolSearchNotes"`
	ToolGetDay           bool   `json:"toolGetDay"`
	ToolListDays         bool   `json:"toolListDays"`
	ToolListProjects     bool   `json:"toolListProjects"`
	SearchResultLimit    int    `json:"searchResultLimit"`
}

type SettingsView struct {
	Settings
	APIKeySource string  `json:"apiKeySource"` // stored | env | none
	APIKeyHint   *string `json:"apiKeyHint"`
}

type AgentConfig struct {
	Settings
	APIKey string `json:"apiKey"`
}

// jsonRaw is a tiny alias so handlers can pass agent output through untouched.
type jsonRaw = json.RawMessage
