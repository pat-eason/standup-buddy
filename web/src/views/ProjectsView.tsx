import { useState } from 'react';
import type { Project } from '../types';
import { Icon } from '../components/Icon';
import { errMsg, useToast } from '../components/ui';
import { api } from '../api';

const SWATCHES = ['#ff5a5f', '#173b4f', '#4f9c7e', '#e0a93b', '#7567c9', '#3f93c2', '#c26a9b'];

function ProjectRow({ project, onChanged }: { project: Project; onChanged: () => Promise<void> }) {
  const toast = useToast();
  const [name, setName] = useState(project.name);

  const update = async (patch: Parameters<typeof api.updateProject>[1]) => {
    try {
      await api.updateProject(project.id, patch);
      await onChanged();
    } catch (e) {
      toast(errMsg(e), true);
    }
  };
  const remove = async () => {
    if (!window.confirm(`Delete "${project.name}"? It will be removed from all entries and points.`)) return;
    try {
      await api.deleteProject(project.id);
      await onChanged();
    } catch (e) {
      toast(errMsg(e), true);
    }
  };

  return (
    <div className="project-row" style={{ opacity: project.archived ? 0.55 : 1 }}>
      <span className="color-dot" style={{ background: project.color }} />
      <div className="row">
        <input
          className="input"
          style={{ maxWidth: 260 }}
          value={name}
          aria-label="Project name"
          onChange={(e) => setName(e.target.value)}
          onBlur={() => name.trim() && name !== project.name && void update({ name })}
        />
        <div className="swatches">
          {SWATCHES.map((c) => (
            <button
              key={c}
              aria-label={`Color ${c}`}
              className={`swatch ${project.color === c ? 'on' : ''}`}
              style={{ background: c }}
              onClick={() => void update({ color: c })}
            />
          ))}
        </div>
      </div>
      <div className="row">
        <button className="btn btn-ghost btn-sm" onClick={() => void update({ archived: !project.archived })}>
          {project.archived ? 'Restore' : 'Archive'}
        </button>
        <button className="icon-btn danger" aria-label="Delete project" onClick={() => void remove()}><Icon name="trash" size={16} /></button>
      </div>
    </div>
  );
}

export function ProjectsView({ projects, onChanged }: { projects: Project[]; onChanged: () => Promise<void> }) {
  const toast = useToast();
  const [name, setName] = useState('');

  const add = async () => {
    if (!name.trim()) return;
    try {
      await api.createProject(name);
      setName('');
      await onChanged();
    } catch (e) {
      toast(errMsg(e), true);
    }
  };

  return (
    <div className="page">
      <div>
        <h1 style={{ fontSize: 38 }}>Projects</h1>
        <div className="muted">Tag stream entries and standup points so the agent can search by project.</div>
      </div>
      <div className="card card-pad row">
        <input
          className="input"
          value={name}
          placeholder="New project name"
          aria-label="New project name"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void add()}
        />
        <button className="btn btn-dark" disabled={!name.trim()} onClick={() => void add()}><Icon name="plus" size={16} /> Add</button>
      </div>
      <div className="card">
        {projects.length === 0 && <div className="empty"><h3>No projects yet</h3>Add one above, or create one inline while logging.</div>}
        {projects.map((p) => (
          <ProjectRow key={p.id} project={p} onChanged={onChanged} />
        ))}
      </div>
    </div>
  );
}
