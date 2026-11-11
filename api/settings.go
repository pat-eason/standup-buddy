package main

import (
	"bytes"
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

func defaultSettings() Settings {
	return Settings{
		CollateModel:      "claude-haiku-5-5",
		FinalizeModel:     "claude-haiku-5-5",
		ChatModel:         "claude-haiku-5-5",
		ThinkingLevel:     "low",
		ToolSearchNotes:   true,
		ToolGetDay:        true,
		ToolListDays:      true,
		ToolListProjects:  true,
		SearchResultLimit: 12,
	}
}

type settingsPatch struct {
	CollateModel         *string `json:"collateModel"`
	FinalizeModel        *string `json:"finalizeModel"`
	ChatModel            *string `json:"chatModel"`
	ThinkingLevel        *string `json:"thinkingLevel"`
	UserContext          *string `json:"userContext"`
	CollateInstructions  *string `json:"collateInstructions"`
	FinalizeInstructions *string `json:"finalizeInstructions"`
	ToolSearchNotes      *bool   `json:"toolSearchNotes"`
	ToolGetDay           *bool   `json:"toolGetDay"`
	ToolListDays         *bool   `json:"toolListDays"`
	ToolListProjects     *bool   `json:"toolListProjects"`
	SearchResultLimit    *int    `json:"searchResultLimit"`
}

var thinkingLevels = map[string]bool{"off": true, "minimal": true, "low": true, "medium": true, "high": true}

// Config owns settings persistence and API key encryption (AES-256-GCM, key derived from APP_SECRET).
type Config struct {
	store  *Store
	secret [32]byte
	envKey string
}

func newConfig(store *Store, appSecret, envKey string) *Config {
	return &Config{store: store, secret: sha256.Sum256([]byte(appSecret)), envKey: envKey}
}

func (c *Config) Get(ctx context.Context) (Settings, error) {
	s := defaultSettings()
	var raw []byte
	err := c.store.pool.QueryRow(ctx, `SELECT value FROM settings WHERE key = 'config'`).Scan(&raw)
	if errors.Is(err, pgx.ErrNoRows) {
		return s, nil
	}
	if err != nil {
		return s, err
	}
	// Unmarshal over the defaults so newly added settings keep their default.
	if err := json.Unmarshal(raw, &s); err != nil {
		return defaultSettings(), nil
	}
	return s, nil
}

func (c *Config) Patch(ctx context.Context, p settingsPatch) (Settings, error) {
	s, err := c.Get(ctx)
	if err != nil {
		return s, err
	}
	set := func(dst *string, src *string) {
		if src != nil {
			*dst = strings.TrimSpace(*src)
		}
	}
	setRaw := func(dst *string, src *string) {
		if src != nil {
			*dst = *src
		}
	}
	set(&s.CollateModel, p.CollateModel)
	set(&s.FinalizeModel, p.FinalizeModel)
	set(&s.ChatModel, p.ChatModel)
	setRaw(&s.UserContext, p.UserContext)
	setRaw(&s.CollateInstructions, p.CollateInstructions)
	setRaw(&s.FinalizeInstructions, p.FinalizeInstructions)
	if p.ThinkingLevel != nil {
		if !thinkingLevels[*p.ThinkingLevel] {
			return s, bad("invalid thinking level")
		}
		s.ThinkingLevel = *p.ThinkingLevel
	}
	if p.ToolSearchNotes != nil {
		s.ToolSearchNotes = *p.ToolSearchNotes
	}
	if p.ToolGetDay != nil {
		s.ToolGetDay = *p.ToolGetDay
	}
	if p.ToolListDays != nil {
		s.ToolListDays = *p.ToolListDays
	}
	if p.ToolListProjects != nil {
		s.ToolListProjects = *p.ToolListProjects
	}
	if p.SearchResultLimit != nil {
		s.SearchResultLimit = max(3, min(40, *p.SearchResultLimit))
	}
	if s.CollateModel == "" || s.FinalizeModel == "" || s.ChatModel == "" {
		return s, bad("model ids cannot be empty")
	}
	raw, _ := json.Marshal(s)
	_, err = c.store.pool.Exec(ctx, `INSERT INTO settings (key, value) VALUES ('config', $1::jsonb)
		ON CONFLICT (key) DO UPDATE SET value = excluded.value`, string(raw))
	return s, err
}

func (c *Config) encrypt(plain string) (string, error) {
	block, err := aes.NewCipher(c.secret[:])
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return "", err
	}
	return base64.StdEncoding.EncodeToString(gcm.Seal(nonce, nonce, []byte(plain), nil)), nil
}

func (c *Config) decrypt(enc string) (string, error) {
	data, err := base64.StdEncoding.DecodeString(enc)
	if err != nil {
		return "", err
	}
	block, err := aes.NewCipher(c.secret[:])
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	if len(data) < gcm.NonceSize() {
		return "", errors.New("ciphertext too short")
	}
	plain, err := gcm.Open(nil, data[:gcm.NonceSize()], data[gcm.NonceSize():], nil)
	return string(plain), err
}

// APIKey returns the stored key, else the ANTHROPIC_API_KEY environment value.
func (c *Config) APIKey(ctx context.Context) (key string, source string) {
	var enc string
	err := c.store.pool.QueryRow(ctx, `SELECT value #>> '{}' FROM settings WHERE key = 'anthropic_api_key'`).Scan(&enc)
	if err == nil {
		if k, derr := c.decrypt(enc); derr == nil && k != "" {
			return k, "stored"
		}
	}
	if c.envKey != "" {
		return c.envKey, "env"
	}
	return "", "none"
}

func (c *Config) SetAPIKey(ctx context.Context, key string) error {
	key = strings.TrimSpace(key)
	if key == "" {
		_, err := c.store.pool.Exec(ctx, `DELETE FROM settings WHERE key = 'anthropic_api_key'`)
		return err
	}
	enc, err := c.encrypt(key)
	if err != nil {
		return err
	}
	encJSON, _ := json.Marshal(enc)
	_, err = c.store.pool.Exec(ctx, `INSERT INTO settings (key, value) VALUES ('anthropic_api_key', $1::jsonb)
		ON CONFLICT (key) DO UPDATE SET value = excluded.value`, string(encJSON))
	return err
}

func (c *Config) View(ctx context.Context) (SettingsView, error) {
	s, err := c.Get(ctx)
	if err != nil {
		return SettingsView{}, err
	}
	key, source := c.APIKey(ctx)
	v := SettingsView{Settings: s, APIKeySource: source}
	if key != "" {
		hint := key
		if len(key) > 11 {
			hint = key[:7] + "…" + key[len(key)-4:]
		}
		v.APIKeyHint = &hint
	}
	return v, nil
}

func (c *Config) Agent(ctx context.Context) (AgentConfig, error) {
	s, err := c.Get(ctx)
	if err != nil {
		return AgentConfig{}, err
	}
	key, _ := c.APIKey(ctx)
	return AgentConfig{Settings: s, APIKey: key}, nil
}

// TestKey makes a tiny Anthropic Messages request to prove the key and model work.
func (c *Config) TestKey(ctx context.Context) (string, error) {
	key, _ := c.APIKey(ctx)
	if key == "" {
		return "", bad("no Anthropic API key configured")
	}
	s, err := c.Get(ctx)
	if err != nil {
		return "", err
	}
	base := strings.TrimRight(os.Getenv("ANTHROPIC_BASE_URL"), "/")
	if base == "" {
		base = "https://api.anthropic.com"
	}
	body, _ := json.Marshal(map[string]any{
		"model":      s.ChatModel,
		"max_tokens": 16,
		"messages":   []map[string]string{{"role": "user", "content": "Reply with the single word: ready"}},
	})
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	req, _ := http.NewRequestWithContext(ctx, http.MethodPost, base+"/v1/messages", bytes.NewReader(body))
	req.Header.Set("content-type", "application/json")
	req.Header.Set("x-api-key", key)
	req.Header.Set("anthropic-version", "2023-06-01")
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", err
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	if res.StatusCode >= 300 {
		var e struct {
			Error struct {
				Message string `json:"message"`
			} `json:"error"`
		}
		_ = json.Unmarshal(raw, &e)
		msg := e.Error.Message
		if msg == "" {
			msg = strings.TrimSpace(string(raw))
		}
		return "", fmt.Errorf("Anthropic returned %d: %s", res.StatusCode, msg)
	}
	var ok struct {
		Content []struct {
			Text string `json:"text"`
		} `json:"content"`
	}
	_ = json.Unmarshal(raw, &ok)
	if len(ok.Content) > 0 {
		return strings.TrimSpace(ok.Content[0].Text), nil
	}
	return "ok", nil
}
