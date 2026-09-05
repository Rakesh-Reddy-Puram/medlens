import { useState, useEffect, useMemo, useRef } from 'react';
import {
  User, FileText, ClipboardList, Clock, Sparkles, AlertTriangle, Plus, X,
  Search, Download, Edit3, Check, RefreshCw, Loader2, ArrowUp, ArrowDown,
  Minus, ChevronRight, ChevronDown, Trash2, ShieldAlert, FlaskConical
} from 'lucide-react';

/* ---------------------------------------------------------------------- */
/* Constants & helpers                                                     */
/* ---------------------------------------------------------------------- */

const STORAGE_KEY = 'phr-record-v1';

const uid = () => Math.random().toString(36).slice(2, 10);
const nowISO = () => new Date().toISOString();
const todayInput = () => new Date().toISOString().slice(0, 10);

function formatDate(d) {
  if (!d) return '—';
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return d;
  return dt.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function formatDateTime(d) {
  if (!d) return '—';
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return d;
  return dt.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

const STATUS_META = {
  low: { label: 'Low', color: 'var(--status-low)' },
  high: { label: 'High', color: 'var(--status-high)' },
  normal: { label: 'Normal', color: 'var(--status-normal)' },
  unknown: { label: 'Not determined', color: 'var(--status-unknown)' },
};

function emptyPatient() {
  return {
    name: '', age: '', sex: '', heightCm: '', weightKg: '',
    symptoms: [], conditions: [], allergies: [], medications: [], notes: '',
    mrn: 'MRN-' + uid().toUpperCase(),
    createdAt: nowISO(), updatedAt: null,
  };
}

function emptyRecord() {
  return { patient: emptyPatient(), reports: [], summary: null, auditLog: [] };
}

function withAudit(record, action, detail) {
  return {
    ...record,
    auditLog: [...record.auditLog, { id: uid(), timestamp: nowISO(), action, detail }],
  };
}

async function callClaude(system, userContent, maxTokens = 1000) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: userContent }],
    }),
  });
  if (!response.ok) throw new Error('The AI service returned an error (' + response.status + ').');
  const data = await response.json();
  const text = (data.content || []).map((b) => b.text || '').join('\n');
  const cleaned = text.replace(/```json/gi, '').replace(/```/g, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch (e) {
    throw new Error('The AI response could not be read as structured data. Please try again.');
  }
}

const EXTRACTION_SYSTEM = `You are a meticulous clinical data-entry assistant. You extract ONLY information explicitly present in the medical report text a user pastes to you.
Strict rules:
- Never invent, estimate, or recall a "typical" reference range. If a reference range is not written in the text, set referenceRange to null and status to "unknown".
- Only derive low/normal/high from a reference range that is explicitly present alongside the value in the text.
- Do not add tests, values, or observations that are not present in the text.
- Do not diagnose or interpret clinical meaning beyond what the report itself states.
- If handwriting or OCR artifacts make something ambiguous, still extract your best reading but lower the confidence score and mention it in extractionNotes.
Respond with ONLY raw JSON (no markdown fences, no commentary) matching exactly this schema:
{"reportDate": string|null, "tests":[{"testName": string, "value": string, "unit": string|null, "referenceRange": string|null, "status": "low"|"normal"|"high"|"unknown", "observation": string|null, "confidence": number}], "generalObservations": string|null, "extractionNotes": string|null}`;

const SUMMARY_SYSTEM = `You write short, plain-language summaries of a patient's organized medical information, for the patient themselves to read.
Strict rules:
- Never state or imply a diagnosis.
- Never recommend medications, dosages, supplements, or treatment changes.
- Only describe what is present in the data you are given — do not add outside medical knowledge about what a condition "usually" means.
- Note factually which values fall outside their stated reference range, without alarming language.
- If reference ranges are missing for a value, say that a range wasn't available rather than guessing whether it's normal.
- Always close by encouraging the person to review this with their clinician.
Respond with ONLY raw JSON (no markdown fences): {"summary": string, "pointsToDiscuss": string[]}`;

const SAMPLE_PATIENT = {
  name: 'Jordan Casey', age: '42', sex: 'Female', heightCm: '165', weightKg: '68',
  symptoms: ['Fatigue for 3 weeks', 'Occasional dizziness'],
  conditions: ['Hypothyroidism (diagnosed 2019)'],
  allergies: ['Penicillin'],
  medications: [{ id: uid(), name: 'Levothyroxine', dose: '75mcg', frequency: 'Once daily, morning' }],
  notes: 'Reports feeling more tired than usual since starting a new work schedule.',
};

const SAMPLE_REPORT_TEXT = `Bright Path Diagnostics — Complete Blood Count & Metabolic Panel
Patient: J. Casey   Collected: 2026-08-12   Reported: 2026-08-13

Test                    Result    Units      Reference Range     Flag
Hemoglobin              10.8      g/dL       12.0 - 15.5          L
Hematocrit              33.5      %          36.0 - 46.0          L
White Blood Cell Count  6.4       x10^9/L    4.0 - 11.0
Platelet Count          410       x10^9/L    150 - 450
TSH                     6.8       mIU/L      0.4 - 4.0             H
Free T4                 1.0       ng/dL      0.8 - 1.8
Fasting Glucose         98        mg/dL      70 - 99
Sodium                  139       mmol/L     135 - 145
Potassium               4.1       mmol/L     3.5 - 5.1

Comments: Mild anemia noted, recommend clinical correlation. TSH elevated relative to prior reading.`;

/* ---------------------------------------------------------------------- */
/* Small shared UI pieces                                                  */
/* ---------------------------------------------------------------------- */

function ProvenanceTag({ kind }) {
  const map = {
    user: { label: 'You provided', cls: 'prov-user' },
    'ai-extracted': { label: 'AI-extracted', cls: 'prov-ai' },
    'user-verified': { label: 'You verified', cls: 'prov-verified' },
    'user-edited': { label: 'You edited', cls: 'prov-edited' },
    'ai-generated': { label: 'AI-generated', cls: 'prov-ai' },
  };
  const m = map[kind] || map['ai-extracted'];
  return <span className={'prov-tag ' + m.cls}>{m.label}</span>;
}

function StatusChip({ status }) {
  const meta = STATUS_META[status] || STATUS_META.unknown;
  return <span className="status-chip" style={{ '--chip-color': meta.color }}>{meta.label}</span>;
}

function ConfidenceBar({ value }) {
  const pct = Math.round((value ?? 0) * 100);
  return (
    <div className="conf-wrap" title={pct + '% extraction confidence'}>
      <div className="conf-track"><div className="conf-fill" style={{ width: pct + '%' }} /></div>
      <span className="conf-pct">{pct}%</span>
    </div>
  );
}

function TagField({ label, values, onAdd, onRemove, placeholder }) {
  const [val, setVal] = useState('');
  const submit = () => { const v = val.trim(); if (v) { onAdd(v); setVal(''); } };
  return (
    <div className="field">
      <label className="label">{label}</label>
      <div className="tag-input-row">
        <input
          className="input"
          value={val}
          placeholder={placeholder}
          onChange={(e) => setVal(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } }}
        />
        <button type="button" className="btn btn-ghost" onClick={submit}><Plus size={14} /> Add</button>
      </div>
      {values.length > 0 && (
        <div className="chip-row">
          {values.map((v, i) => (
            <span key={i} className="chip">{v}<button type="button" onClick={() => onRemove(i)}><X size={12} /></button></span>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Patient tab                                                             */
/* ---------------------------------------------------------------------- */

function PatientTab({ patient, onSave, onLoadSample }) {
  const [draft, setDraft] = useState(patient);
  const [medName, setMedName] = useState('');
  const [medDose, setMedDose] = useState('');
  const [medFreq, setMedFreq] = useState('');
  const [dirty, setDirty] = useState(false);

  useEffect(() => { setDraft(patient); setDirty(false); }, [patient.updatedAt]);

  const set = (key, value) => { setDraft((d) => ({ ...d, [key]: value })); setDirty(true); };
  const addTag = (key, value) => set(key, [...draft[key], value]);
  const removeTag = (key, idx) => set(key, draft[key].filter((_, i) => i !== idx));

  const addMedication = () => {
    if (!medName.trim()) return;
    set('medications', [...draft.medications, { id: uid(), name: medName.trim(), dose: medDose.trim(), frequency: medFreq.trim() }]);
    setMedName(''); setMedDose(''); setMedFreq('');
  };
  const removeMedication = (id) => set('medications', draft.medications.filter((m) => m.id !== id));

  return (
    <div className="panel">
      <div className="panel-header">
        <div>
          <h2 className="section-title">Patient profile</h2>
          <p className="section-sub">Everything here is information you provide directly — tagged accordingly throughout the record.</p>
        </div>
        {!patient.updatedAt && (
          <button type="button" className="btn btn-ghost" onClick={onLoadSample}><FlaskConical size={14} /> Load sample patient</button>
        )}
      </div>

      <div className="card">
        <div className="grid-2">
          <div className="field">
            <label className="label">Full name</label>
            <input className="input" value={draft.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Jordan Casey" />
          </div>
          <div className="field">
            <label className="label">Record ID</label>
            <input className="input mono" value={draft.mrn} readOnly />
          </div>
          <div className="field">
            <label className="label">Age</label>
            <input className="input" value={draft.age} onChange={(e) => set('age', e.target.value)} placeholder="e.g. 42" inputMode="numeric" />
          </div>
          <div className="field">
            <label className="label">Sex</label>
            <select className="input" value={draft.sex} onChange={(e) => set('sex', e.target.value)}>
              <option value="">Select</option>
              <option>Female</option>
              <option>Male</option>
              <option>Other</option>
              <option>Prefer not to say</option>
            </select>
          </div>
          <div className="field">
            <label className="label">Height (cm)</label>
            <input className="input" value={draft.heightCm} onChange={(e) => set('heightCm', e.target.value)} inputMode="decimal" />
          </div>
          <div className="field">
            <label className="label">Weight (kg)</label>
            <input className="input" value={draft.weightKg} onChange={(e) => set('weightKg', e.target.value)} inputMode="decimal" />
          </div>
        </div>
      </div>

      <div className="card">
        <TagField label="Current symptoms" values={draft.symptoms} placeholder="e.g. Fatigue for 3 weeks"
          onAdd={(v) => addTag('symptoms', v)} onRemove={(i) => removeTag('symptoms', i)} />
        <TagField label="Existing conditions" values={draft.conditions} placeholder="e.g. Type 2 diabetes"
          onAdd={(v) => addTag('conditions', v)} onRemove={(i) => removeTag('conditions', i)} />
        <TagField label="Allergies" values={draft.allergies} placeholder="e.g. Penicillin"
          onAdd={(v) => addTag('allergies', v)} onRemove={(i) => removeTag('allergies', i)} />
      </div>

      <div className="card">
        <label className="label">Current medications</label>
        <div className="med-input-row">
          <input className="input" placeholder="Name" value={medName} onChange={(e) => setMedName(e.target.value)} />
          <input className="input" placeholder="Dose" value={medDose} onChange={(e) => setMedDose(e.target.value)} />
          <input className="input" placeholder="Frequency" value={medFreq} onChange={(e) => setMedFreq(e.target.value)} />
          <button type="button" className="btn btn-ghost" onClick={addMedication}><Plus size={14} /> Add</button>
        </div>
        {draft.medications.length > 0 && (
          <ul className="med-list">
            {draft.medications.map((m) => (
              <li key={m.id}>
                <span><strong>{m.name}</strong>{m.dose ? ' · ' + m.dose : ''}{m.frequency ? ' · ' + m.frequency : ''}</span>
                <button type="button" className="icon-btn" onClick={() => removeMedication(m.id)}><Trash2 size={14} /></button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="card">
        <label className="label">Notes</label>
        <textarea className="input textarea" rows={3} value={draft.notes} onChange={(e) => set('notes', e.target.value)}
          placeholder="Anything else worth recording — context, recent events, concerns…" />
      </div>

      <div className="panel-footer">
        <span className="muted-note">{patient.updatedAt ? 'Last saved ' + formatDateTime(patient.updatedAt) : 'Not saved yet'}</span>
        <button type="button" className="btn btn-primary" disabled={!dirty} onClick={() => onSave(draft)}>
          <Check size={15} /> Save profile
        </button>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Add Report tab                                                          */
/* ---------------------------------------------------------------------- */

function AddReportTab({ existingTests, onCommit }) {
  const [title, setTitle] = useState('');
  const [manualDate, setManualDate] = useState('');
  const [rawText, setRawText] = useState('');
  const [status, setStatus] = useState('idle'); // idle | loading | error | ready
  const [error, setError] = useState('');
  const [draftResult, setDraftResult] = useState(null); // parsed AI result
  const [draftTests, setDraftTests] = useState([]);

  const loadSample = () => {
    setTitle('Complete Blood Count & Metabolic Panel');
    setRawText(SAMPLE_REPORT_TEXT);
  };

  const runExtraction = async () => {
    if (!rawText.trim()) { setError('Paste the report text first.'); return; }
    setStatus('loading'); setError('');
    try {
      const result = await callClaude(EXTRACTION_SYSTEM, rawText);
      setDraftResult(result);
      setDraftTests((result.tests || []).map((t) => ({ ...t, id: uid() })));
      setStatus('ready');
    } catch (e) {
      setError(e.message || 'Extraction failed.');
      setStatus('error');
    }
  };

  const conflicts = useMemo(() => {
    if (!draftTests.length) return [];
    const effectiveDate = manualDate || draftResult?.reportDate || null;
    if (!effectiveDate) return [];
    const found = [];
    draftTests.forEach((t) => {
      const key = t.testName.trim().toLowerCase();
      existingTests.forEach((ex) => {
        if (ex.reportDate === effectiveDate && ex.testName.trim().toLowerCase() === key && ex.value !== t.value) {
          found.push({ testName: t.testName, newValue: t.value, oldValue: ex.value, reportTitle: ex.reportTitle });
        }
      });
    });
    return found;
  }, [draftTests, existingTests, manualDate, draftResult]);

  const updateDraftTest = (id, patch) => setDraftTests((ts) => ts.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  const removeDraftTest = (id) => setDraftTests((ts) => ts.filter((t) => t.id !== id));

  const commit = () => {
    const reportDate = manualDate || draftResult?.reportDate || todayInput();
    onCommit({
      id: uid(),
      title: title.trim() || 'Untitled report',
      reportDate,
      rawText,
      generalObservations: draftResult?.generalObservations || null,
      extractionNotes: draftResult?.extractionNotes || null,
      extractedAt: nowISO(),
      tests: draftTests.map((t) => ({ ...t, provenance: 'ai-extracted', verified: false })),
    });
    setTitle(''); setManualDate(''); setRawText(''); setDraftResult(null); setDraftTests([]); setStatus('idle');
  };

  return (
    <div className="panel">
      <div className="panel-header">
        <div>
          <h2 className="section-title">Add a medical report</h2>
          <p className="section-sub">Paste the text of a lab report, prescription, or clinical note. Reference ranges are only used when the report itself states them — nothing is invented.</p>
        </div>
        <button type="button" className="btn btn-ghost" onClick={loadSample}><FlaskConical size={14} /> Load sample report</button>
      </div>

      <div className="card">
        <div className="grid-2">
          <div className="field">
            <label className="label">Report title</label>
            <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Basic Metabolic Panel — Aug 2026" />
          </div>
          <div className="field">
            <label className="label">Report date (optional — AI will look for one otherwise)</label>
            <input className="input" type="date" value={manualDate} onChange={(e) => setManualDate(e.target.value)} />
          </div>
        </div>
        <div className="field">
          <label className="label">Report text</label>
          <textarea className="input textarea mono" rows={10} value={rawText} onChange={(e) => setRawText(e.target.value)}
            placeholder="Paste the full text of the report here…" />
        </div>
        {error && <div className="banner banner-warning"><AlertTriangle size={15} /> {error}</div>}
        <div className="panel-footer">
          <span className="muted-note">Large panels may need to be pasted in smaller sections for complete extraction.</span>
          <button type="button" className="btn btn-primary" onClick={runExtraction} disabled={status === 'loading'}>
            {status === 'loading' ? <Loader2 size={15} className="spin" /> : <Sparkles size={15} />}
            {status === 'loading' ? 'Extracting…' : 'Extract structured data'}
          </button>
        </div>
      </div>

      {status === 'ready' && (
        <div className="card">
          <h3 className="section-title small">Review before saving</h3>
          <p className="section-sub">Source text on the left, AI-extracted fields on the right. Edit anything before it's added to the record.</p>

          {conflicts.length > 0 && (
            <div className="banner banner-warning">
              <AlertTriangle size={15} />
              <div>
                <strong>Possible conflict with existing data:</strong>
                <ul>
                  {conflicts.map((c, i) => (
                    <li key={i}>{c.testName}: new value "{c.newValue}" differs from "{c.oldValue}" already recorded for the same date ({c.reportTitle}).</li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          <div className="side-by-side">
            <div className="source-pane">
              <div className="pane-label">Source text</div>
              <pre className="raw-text">{rawText}</pre>
            </div>
            <div className="extract-pane">
              <div className="pane-label">Extracted tests ({draftTests.length})</div>
              {draftTests.length === 0 && <p className="muted-note">No discrete test values were found in this text.</p>}
              <div className="test-edit-list">
                {draftTests.map((t) => (
                  <div className="test-edit-row" key={t.id}>
                    <div className="test-edit-grid">
                      <input className="input" value={t.testName} onChange={(e) => updateDraftTest(t.id, { testName: e.target.value })} />
                      <input className="input mono" value={t.value} onChange={(e) => updateDraftTest(t.id, { value: e.target.value })} />
                      <input className="input mono" value={t.unit || ''} placeholder="unit" onChange={(e) => updateDraftTest(t.id, { unit: e.target.value })} />
                      <input className="input mono" value={t.referenceRange || ''} placeholder="reference range" onChange={(e) => updateDraftTest(t.id, { referenceRange: e.target.value })} />
                      <select className="input" value={t.status} onChange={(e) => updateDraftTest(t.id, { status: e.target.value })}>
                        <option value="low">Low</option>
                        <option value="normal">Normal</option>
                        <option value="high">High</option>
                        <option value="unknown">Not determined</option>
                      </select>
                      <button type="button" className="icon-btn" onClick={() => removeDraftTest(t.id)}><Trash2 size={14} /></button>
                    </div>
                    <div className="test-edit-meta">
                      <ConfidenceBar value={t.confidence} />
                      {t.observation && <span className="muted-note">Note: {t.observation}</span>}
                    </div>
                  </div>
                ))}
              </div>
              {draftResult?.generalObservations && (
                <div className="field"><label className="label">General observations (from source)</label><p className="muted-note">{draftResult.generalObservations}</p></div>
              )}
              {draftResult?.extractionNotes && (
                <div className="banner banner-info"><AlertTriangle size={14} /> {draftResult.extractionNotes}</div>
              )}
            </div>
          </div>

          <div className="panel-footer">
            <button type="button" className="btn btn-ghost" onClick={() => { setStatus('idle'); setDraftResult(null); setDraftTests([]); }}>Discard</button>
            <button type="button" className="btn btn-primary" onClick={commit}><Check size={15} /> Save to record</button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Structured Record tab                                                   */
/* ---------------------------------------------------------------------- */

function RecordTab({ patient, reports, onUpdateTest, onExport }) {
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [openSource, setOpenSource] = useState({});
  const [editingId, setEditingId] = useState(null);
  const [editDraft, setEditDraft] = useState(null);

  const allTests = useMemo(() => reports.flatMap((r) =>
    r.tests.map((t) => ({ ...t, reportId: r.id, reportTitle: r.title, reportDate: r.reportDate }))
  ), [reports]);

  const conflicts = useMemo(() => {
    const byKey = {};
    allTests.forEach((t) => {
      const key = t.testName.trim().toLowerCase() + '|' + t.reportDate;
      (byKey[key] = byKey[key] || []).push(t);
    });
    const out = [];
    Object.values(byKey).forEach((group) => {
      const distinct = [...new Set(group.map((g) => g.value))];
      if (distinct.length > 1) out.push({ testName: group[0].testName, date: group[0].reportDate, values: distinct });
    });
    return out;
  }, [allTests]);

  const lowConfidence = useMemo(() => allTests.filter((t) => !t.verified && (t.confidence ?? 1) < 0.6), [allTests]);
  const missingRange = useMemo(() => allTests.filter((t) => t.status === 'unknown' && !t.referenceRange), [allTests]);

  const filtered = allTests.filter((t) => {
    const matchesQuery = !query || t.testName.toLowerCase().includes(query.toLowerCase());
    const matchesStatus = statusFilter === 'all' || t.status === statusFilter;
    return matchesQuery && matchesStatus;
  }).sort((a, b) => new Date(b.reportDate) - new Date(a.reportDate));

  const startEdit = (t) => { setEditingId(t.id); setEditDraft({ ...t }); };
  const saveEdit = () => {
    onUpdateTest(editDraft.reportId, editDraft.id, {
      testName: editDraft.testName, value: editDraft.value, unit: editDraft.unit,
      referenceRange: editDraft.referenceRange, status: editDraft.status,
      provenance: 'user-edited', verified: true,
    });
    setEditingId(null); setEditDraft(null);
  };
  const markVerified = (t) => onUpdateTest(t.reportId, t.id, { verified: true, provenance: t.provenance === 'ai-extracted' ? 'user-verified' : t.provenance });

  return (
    <div className="panel">
      <div className="panel-header">
        <div>
          <h2 className="section-title">Structured record</h2>
          <p className="section-sub">Every value carries its source, its stated reference range, and how confident the extraction was.</p>
        </div>
        <button type="button" className="btn btn-ghost" onClick={onExport}><Download size={14} /> Export record</button>
      </div>

      {patient.allergies.length > 0 && (
        <div className="banner banner-danger"><ShieldAlert size={15} /> Allergies on file: {patient.allergies.join(', ')}</div>
      )}

      {(conflicts.length > 0 || lowConfidence.length > 0 || missingRange.length > 0) && (
        <div className="card flags-card">
          <h3 className="section-title small">Flags for your review</h3>
          {conflicts.map((c, i) => (
            <div className="banner banner-warning" key={'c' + i}><AlertTriangle size={14} />
              Conflicting values for <strong>{c.testName}</strong> on {formatDate(c.date)}: {c.values.join(' vs ')}. Check the source reports.
            </div>
          ))}
          {lowConfidence.length > 0 && (
            <div className="banner banner-info"><AlertTriangle size={14} />
              {lowConfidence.length} extracted value{lowConfidence.length > 1 ? 's' : ''} had low extraction confidence and haven't been verified yet.
            </div>
          )}
          {missingRange.length > 0 && (
            <div className="banner banner-info"><AlertTriangle size={14} />
              {missingRange.length} test{missingRange.length > 1 ? 's' : ''} had no reference range in the source, so status couldn't be determined. Add one manually if you know it.
            </div>
          )}
        </div>
      )}

      <div className="card">
        <div className="filter-row">
          <div className="search-box">
            <Search size={14} />
            <input className="input bare" placeholder="Search tests…" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          <div className="filter-chips">
            {['all', 'low', 'normal', 'high', 'unknown'].map((s) => (
              <button type="button" key={s} className={'filter-chip' + (statusFilter === s ? ' active' : '')} onClick={() => setStatusFilter(s)}>
                {s === 'all' ? 'All' : STATUS_META[s].label}
              </button>
            ))}
          </div>
        </div>

        {filtered.length === 0 ? (
          <p className="muted-note empty-note">No test results yet — add a report to populate this record.</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr><th>Date</th><th>Test</th><th>Value</th><th>Reference range</th><th>Status</th><th>Confidence</th><th>Source</th><th></th></tr>
              </thead>
              <tbody>
                {filtered.map((t) => (
                  editingId === t.id ? (
                    <tr key={t.id} className="editing-row">
                      <td className="mono">{formatDate(t.reportDate)}</td>
                      <td><input className="input" value={editDraft.testName} onChange={(e) => setEditDraft({ ...editDraft, testName: e.target.value })} /></td>
                      <td><input className="input mono" style={{ width: 80 }} value={editDraft.value} onChange={(e) => setEditDraft({ ...editDraft, value: e.target.value })} />
                        <input className="input mono" style={{ width: 60 }} value={editDraft.unit || ''} onChange={(e) => setEditDraft({ ...editDraft, unit: e.target.value })} /></td>
                      <td><input className="input mono" value={editDraft.referenceRange || ''} onChange={(e) => setEditDraft({ ...editDraft, referenceRange: e.target.value })} /></td>
                      <td>
                        <select className="input" value={editDraft.status} onChange={(e) => setEditDraft({ ...editDraft, status: e.target.value })}>
                          <option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option><option value="unknown">Not determined</option>
                        </select>
                      </td>
                      <td><ConfidenceBar value={t.confidence} /></td>
                      <td className="muted-note">{t.reportTitle}</td>
                      <td className="row-actions"><button className="icon-btn" onClick={saveEdit}><Check size={14} /></button><button className="icon-btn" onClick={() => setEditingId(null)}><X size={14} /></button></td>
                    </tr>
                  ) : (
                    <tr key={t.id}>
                      <td className="mono">{formatDate(t.reportDate)}</td>
                      <td>{t.testName}</td>
                      <td className="mono">{t.value} {t.unit || ''}</td>
                      <td className="mono muted-note">{t.referenceRange || 'not stated'}</td>
                      <td><StatusChip status={t.status} /></td>
                      <td><ConfidenceBar value={t.confidence} /></td>
                      <td className="muted-note">{t.reportTitle}<br /><ProvenanceTag kind={t.provenance} /></td>
                      <td className="row-actions">
                        {!t.verified && <button className="icon-btn" title="Mark verified" onClick={() => markVerified(t)}><Check size={14} /></button>}
                        <button className="icon-btn" title="Edit" onClick={() => startEdit(t)}><Edit3 size={14} /></button>
                      </td>
                    </tr>
                  )
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card">
        <h3 className="section-title small">Sources</h3>
        {reports.length === 0 && <p className="muted-note">No reports added yet.</p>}
        {reports.map((r) => (
          <div className="source-card" key={r.id}>
            <button type="button" className="source-toggle" onClick={() => setOpenSource((o) => ({ ...o, [r.id]: !o[r.id] }))}>
              {openSource[r.id] ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              <span>{r.title}</span>
              <span className="muted-note">{formatDate(r.reportDate)} · {r.tests.length} test{r.tests.length !== 1 ? 's' : ''}</span>
            </button>
            {openSource[r.id] && (
              <div className="side-by-side compact">
                <div className="source-pane"><div className="pane-label">Original text</div><pre className="raw-text">{r.rawText}</pre></div>
                <div className="extract-pane">
                  <div className="pane-label">Extracted</div>
                  <ul className="mini-list">
                    {r.tests.map((t) => <li key={t.id}>{t.testName}: <span className="mono">{t.value} {t.unit}</span> <StatusChip status={t.status} /></li>)}
                  </ul>
                  {r.generalObservations && <p className="muted-note">Observations: {r.generalObservations}</p>}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Timeline tab                                                            */
/* ---------------------------------------------------------------------- */

function TrendArrow({ delta }) {
  if (delta === null) return <Minus size={13} className="trend-flat" />;
  if (delta > 0) return <ArrowUp size={13} className="trend-up" />;
  if (delta < 0) return <ArrowDown size={13} className="trend-down" />;
  return <Minus size={13} className="trend-flat" />;
}

function TimelineTab({ reports, auditLog }) {
  const groups = useMemo(() => {
    const byName = {};
    reports.forEach((r) => r.tests.forEach((t) => {
      const key = t.testName.trim().toLowerCase();
      (byName[key] = byName[key] || []).push({ ...t, reportDate: r.reportDate, reportTitle: r.title });
    }));
    return Object.values(byName).map((entries) => {
      const sorted = [...entries].sort((a, b) => new Date(a.reportDate) - new Date(b.reportDate));
      const withDelta = sorted.map((e, i) => {
        if (i === 0) return { ...e, delta: null };
        const prevNum = parseFloat(sorted[i - 1].value);
        const curNum = parseFloat(e.value);
        const delta = isNaN(prevNum) || isNaN(curNum) ? null : curNum - prevNum;
        return { ...e, delta };
      });
      return { testName: sorted[sorted.length - 1].testName, entries: withDelta };
    }).sort((a, b) => a.testName.localeCompare(b.testName));
  }, [reports]);

  const events = [...auditLog].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

  return (
    <div className="panel">
      <div className="panel-header">
        <div>
          <h2 className="section-title">Timeline</h2>
          <p className="section-sub">How each test has moved over time, and a running log of changes to this record.</p>
        </div>
      </div>

      <div className="card">
        <h3 className="section-title small">Test trends</h3>
        {groups.length === 0 && <p className="muted-note">Add more than one report to see trends over time.</p>}
        {groups.map((g) => (
          <div className="trend-group" key={g.testName}>
            <div className="trend-name">{g.testName}</div>
            <div className="trend-row">
              {g.entries.map((e, i) => (
                <div className="trend-point" key={i}>
                  <div className="trend-date">{formatDate(e.reportDate)}</div>
                  <div className="trend-value mono"><TrendArrow delta={e.delta} /> {e.value} {e.unit || ''}</div>
                  <StatusChip status={e.status} />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="card">
        <h3 className="section-title small">Activity log</h3>
        {events.length === 0 && <p className="muted-note">Nothing recorded yet.</p>}
        <ul className="audit-list">
          {events.map((ev) => (
            <li key={ev.id}>
              <Clock size={13} />
              <div><div className="audit-detail">{ev.detail}</div><div className="muted-note">{formatDateTime(ev.timestamp)}</div></div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Summary tab                                                             */
/* ---------------------------------------------------------------------- */

function SummaryTab({ patient, reports, summary, onGenerate }) {
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState('');
  const allTests = reports.flatMap((r) => r.tests.map((t) => ({ testName: t.testName, value: t.value, unit: t.unit, referenceRange: t.referenceRange, status: t.status, reportDate: r.reportDate })));
  const canGenerate = patient.name && (allTests.length > 0 || patient.symptoms.length > 0);

  const run = async () => {
    setStatus('loading'); setError('');
    try {
      const payload = JSON.stringify({
        patient: {
          age: patient.age, sex: patient.sex, symptoms: patient.symptoms, conditions: patient.conditions,
          allergies: patient.allergies, medications: patient.medications.map((m) => m.name + ' ' + m.dose + ' ' + m.frequency), notes: patient.notes,
        },
        tests: allTests,
      });
      const result = await callClaude(SUMMARY_SYSTEM, payload);
      onGenerate({ text: result.summary, pointsToDiscuss: result.pointsToDiscuss || [], generatedAt: nowISO(), basisReportCount: reports.length });
      setStatus('idle');
    } catch (e) {
      setError(e.message || 'Could not generate a summary.');
      setStatus('error');
    }
  };

  return (
    <div className="panel">
      <div className="panel-header">
        <div>
          <h2 className="section-title">Patient-friendly summary</h2>
          <p className="section-sub">A plain-language recap of what's on file — never a diagnosis or treatment recommendation.</p>
        </div>
        <button type="button" className="btn btn-primary" onClick={run} disabled={!canGenerate || status === 'loading'}>
          {status === 'loading' ? <Loader2 size={15} className="spin" /> : <Sparkles size={15} />}
          {summary ? 'Regenerate summary' : 'Generate summary'}
        </button>
      </div>

      {!canGenerate && <p className="muted-note">Add a patient name and at least one symptom or report to generate a summary.</p>}
      {error && <div className="banner banner-warning"><AlertTriangle size={15} /> {error}</div>}

      {summary && (
        <div className="card">
          <div className="summary-head">
            <ProvenanceTag kind="ai-generated" />
            <span className="muted-note">Generated {formatDateTime(summary.generatedAt)} from {summary.basisReportCount} report{summary.basisReportCount !== 1 ? 's' : ''} and the patient profile</span>
          </div>
          <p className="summary-text">{summary.text}</p>
          {summary.pointsToDiscuss.length > 0 && (
            <>
              <h4 className="section-title small">Worth discussing with your clinician</h4>
              <ul className="discuss-list">
                {summary.pointsToDiscuss.map((p, i) => <li key={i}>{p}</li>)}
              </ul>
            </>
          )}
          <div className="banner banner-info"><AlertTriangle size={14} /> This summary organizes existing information only. It is not a diagnosis, and it does not replace a conversation with a qualified clinician.</div>
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* App shell                                                               */
/* ---------------------------------------------------------------------- */

const TABS = [
  { key: 'patient', label: 'Patient profile', icon: User },
  { key: 'add', label: 'Add report', icon: FileText },
  { key: 'record', label: 'Record', icon: ClipboardList },
  { key: 'timeline', label: 'Timeline', icon: Clock },
  { key: 'summary', label: 'Summary', icon: Sparkles },
];

export default function App() {
  const [record, setRecord] = useState(emptyRecord());
  const [loaded, setLoaded] = useState(false);
  const [activeTab, setActiveTab] = useState('patient');

  useEffect(() => {
    (async () => {
      try {
        const res = await window.storage.get(STORAGE_KEY, false);
        if (res && res.value) setRecord(JSON.parse(res.value));
      } catch (e) { /* nothing saved yet */ }
      setLoaded(true);
    })();
  }, []);

  const persist = async (rec) => {
    try { await window.storage.set(STORAGE_KEY, JSON.stringify(rec), false); }
    catch (e) { console.error('Could not save record', e); }
  };

  const updateRecord = (updater) => {
    setRecord((prev) => {
      const next = updater(prev);
      persist(next);
      return next;
    });
  };

  const handleSavePatient = (draft) => {
    updateRecord((prev) => withAudit({ ...prev, patient: { ...draft, updatedAt: nowISO() } }, 'patient-updated', 'Patient profile saved'));
  };
  const handleLoadSamplePatient = () => {
    updateRecord((prev) => withAudit({ ...prev, patient: { ...prev.patient, ...SAMPLE_PATIENT, updatedAt: nowISO() } }, 'patient-updated', 'Sample patient profile loaded'));
  };
  const handleCommitReport = (report) => {
    updateRecord((prev) => withAudit({ ...prev, reports: [...prev.reports, report] }, 'report-added', 'Added report "' + report.title + '" (' + report.tests.length + ' tests)'));
  };
  const handleUpdateTest = (reportId, testId, patch) => {
    updateRecord((prev) => {
      const reports = prev.reports.map((r) => r.id !== reportId ? r : { ...r, tests: r.tests.map((t) => t.id === testId ? { ...t, ...patch } : t) });
      const testName = patch.testName || (prev.reports.find((r) => r.id === reportId)?.tests.find((t) => t.id === testId)?.testName) || 'test';
      return withAudit({ ...prev, reports }, 'test-updated', 'Updated "' + testName + '"');
    });
  };
  const handleGenerateSummary = (summary) => {
    updateRecord((prev) => withAudit({ ...prev, summary }, 'summary-generated', 'AI summary generated'));
  };

  const handleExport = () => {
    const { patient, reports, summary } = record;
    const lines = [];
    lines.push('PATIENT RECORD — ' + (patient.name || 'Unnamed'));
    lines.push('Record ID: ' + patient.mrn);
    lines.push('Exported: ' + formatDateTime(nowISO()));
    lines.push('');
    lines.push('-- PATIENT PROFILE (provided by patient) --');
    lines.push('Age: ' + (patient.age || '—') + '   Sex: ' + (patient.sex || '—'));
    lines.push('Height: ' + (patient.heightCm || '—') + ' cm   Weight: ' + (patient.weightKg || '—') + ' kg');
    lines.push('Symptoms: ' + (patient.symptoms.join('; ') || 'none recorded'));
    lines.push('Conditions: ' + (patient.conditions.join('; ') || 'none recorded'));
    lines.push('Allergies: ' + (patient.allergies.join('; ') || 'none recorded'));
    lines.push('Medications: ' + (patient.medications.map((m) => m.name + ' ' + m.dose + ' ' + m.frequency).join('; ') || 'none recorded'));
    if (patient.notes) lines.push('Notes: ' + patient.notes);
    lines.push('');
    lines.push('-- TEST RESULTS (AI-extracted from reports, human-reviewable) --');
    reports.forEach((r) => {
      lines.push('[' + formatDate(r.reportDate) + '] ' + r.title);
      r.tests.forEach((t) => {
        lines.push('  ' + t.testName + ': ' + t.value + ' ' + (t.unit || '') + '  (range: ' + (t.referenceRange || 'not stated') + ')  [' + STATUS_META[t.status].label + ']  source: ' + t.provenance);
      });
      if (r.generalObservations) lines.push('  Observations: ' + r.generalObservations);
    });
    lines.push('');
    if (summary) {
      lines.push('-- AI-GENERATED SUMMARY (' + formatDateTime(summary.generatedAt) + ') --');
      lines.push(summary.text);
      if (summary.pointsToDiscuss.length) {
        lines.push('Points to discuss with a clinician:');
        summary.pointsToDiscuss.forEach((p) => lines.push('  - ' + p));
      }
    }
    lines.push('');
    lines.push('This document organizes existing information and is not a diagnosis or treatment plan.');

    const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'patient-record-' + record.patient.mrn + '.txt';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const { patient, reports, summary, auditLog } = record;

  let conflictCount = 0;
  {
    const byKey = {};
    reports.forEach((r) => r.tests.forEach((t) => { const key = t.testName.trim().toLowerCase() + '|' + r.reportDate; (byKey[key] = byKey[key] || new Set()).add(t.value); }));
    conflictCount = Object.values(byKey).filter((s) => s.size > 1).length;
  }

  if (!loaded) return <div className="loading-shell"><Loader2 size={20} className="spin" /></div>;

  return (
    <div className="app">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Source+Serif+4:ital,opsz,wght@0,8..60,400;0,8..60,600;0,8..60,700;1,8..60,400&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap');

        :root {
          --paper: #f4f5f1;
          --surface: #ffffff;
          --ink: #1e2622;
          --ink-soft: #5b665f;
          --rule: #dde1d9;
          --accent-teal: #0f6d66;
          --accent-teal-soft: #e3efed;
          --accent-indigo: #3e4c73;
          --accent-indigo-soft: #e7e9f1;
          --accent-amber: #93630f;
          --accent-amber-soft: #f4ecd8;
          --status-low: #93630f;
          --status-high: #a5402f;
          --status-normal: #2f7a5a;
          --status-unknown: #83897f;
          --danger: #a5402f;
          --danger-soft: #f6e6e2;
          --info-soft: #eef1eb;
        }
        * { box-sizing: border-box; }
        .app { font-family: 'IBM Plex Sans', -apple-system, sans-serif; background: var(--paper); color: var(--ink); min-height: 100%; padding: 20px 16px 48px; }
        .mono { font-family: 'IBM Plex Mono', ui-monospace, monospace; }
        
        .hero{position:relative;height:300px;border-radius:12px;overflow:hidden;margin-bottom:18px}
        .hero-bg{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
        .hero-overlay{position:absolute;inset:0;background:linear-gradient(90deg,rgba(15,109,102,.85),rgba(30,38,34,.45))}
        .hero-content{position:relative;z-index:1;padding:28px;color:#fff;height:100%;display:flex;flex-direction:column;justify-content:center}
        .hero-content h1{font-size:34px;margin:0 0 8px;font-family:'Source Serif 4',serif}
        .hero-content p{max-width:560px;margin:0 0 16px;opacity:.95}
        .hero-media{display:flex;gap:10px;flex-wrap:wrap}
        .hero-media img,.hero-media video{width:140px;height:88px;object-fit:cover;border-radius:8px;border:2px solid rgba(255,255,255,.35)}

        .loading-shell { display:flex; align-items:center; justify-content:center; height: 300px; color: var(--ink-soft); }
        .spin { animation: spin 1s linear infinite; }
        @keyframes spin { to { transform: rotate(360deg); } }

        .shell { max-width: 980px; margin: 0 auto; }
        .masthead { display:flex; align-items:baseline; justify-content:space-between; flex-wrap:wrap; gap:8px; margin-bottom: 6px; }
        .wordmark { font-family:'Source Serif 4', Georgia, serif; font-size:26px; font-weight:600; letter-spacing:-0.01em; }
        .wordmark span { color: var(--accent-teal); }
        .patient-chip { font-size:13px; color: var(--ink-soft); }
        .patient-chip strong { color: var(--ink); }

        .disclaimer { font-size:12.5px; color: var(--ink-soft); border-top:1px solid var(--rule); border-bottom:1px solid var(--rule); padding:8px 2px; margin: 10px 0 16px; }
        .allergy-strip { display:flex; align-items:center; gap:6px; background: var(--danger-soft); color: var(--danger); border:1px solid var(--danger); border-radius:3px; padding:6px 10px; font-size:12.5px; margin-bottom:14px; }

        .tabs { display:flex; gap:2px; overflow-x:auto; border-bottom:1px solid var(--rule); }
        .tab { display:flex; align-items:center; gap:6px; padding:10px 16px; font-size:13.5px; font-weight:500; color: var(--ink-soft); background:var(--surface-tab-inactive,#eceee8); border:1px solid var(--rule); border-bottom:none; border-radius:6px 6px 0 0; cursor:pointer; white-space:nowrap; position:relative; top:1px; }
        .tab.active { color: var(--ink); background: var(--surface); border-color: var(--rule); }
        .tab .badge { background: var(--danger); color:#fff; border-radius:8px; font-size:10px; padding:0 5px; margin-left:2px; }

        .panel { background: var(--surface); border:1px solid var(--rule); border-radius: 0 6px 6px 6px; padding: 22px 22px 18px; }
        .panel-header { display:flex; justify-content:space-between; align-items:flex-start; gap:16px; margin-bottom: 14px; flex-wrap:wrap; }
        .section-title { font-family:'Source Serif 4', Georgia, serif; font-size:20px; font-weight:600; margin:0 0 2px; }
        .section-title.small { font-size:15.5px; margin-top:4px; }
        .section-sub { font-size:13px; color: var(--ink-soft); margin:0; max-width:60ch; }

        .card { border:1px solid var(--rule); border-radius:6px; padding:16px; margin-bottom:14px; background: var(--surface); }
        .flags-card { background: var(--info-soft); }
        .grid-2 { display:grid; grid-template-columns:1fr 1fr; gap:12px 16px; }
        @media (max-width: 620px) { .grid-2 { grid-template-columns:1fr; } }

        .field { margin-bottom:12px; }
        .field:last-child { margin-bottom:0; }
        .label { display:block; font-size:12px; color: var(--ink-soft); margin-bottom:4px; font-weight:500; }
        .input { width:100%; border:1px solid var(--rule); border-radius:4px; padding:8px 10px; font-size:13.5px; font-family:inherit; background:#fff; color:var(--ink); }
        .input:focus { outline:2px solid var(--accent-teal); outline-offset:1px; border-color: var(--accent-teal); }
        .input.bare { border:none; padding:4px; }
        .textarea { resize:vertical; }
        select.input { cursor:pointer; }

        .tag-input-row { display:flex; gap:8px; }
        .chip-row { display:flex; flex-wrap:wrap; gap:6px; margin-top:8px; }
        .chip { display:inline-flex; align-items:center; gap:6px; background: var(--accent-indigo-soft); color: var(--accent-indigo); border-radius:14px; padding:4px 6px 4px 10px; font-size:12.5px; }
        .chip button { background:none; border:none; cursor:pointer; color: var(--accent-indigo); display:flex; }

        .med-input-row { display:grid; grid-template-columns: 1.4fr 1fr 1fr auto; gap:8px; margin-bottom:10px; }
        @media (max-width: 620px) { .med-input-row { grid-template-columns:1fr; } }
        .med-list { list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:6px; }
        .med-list li { display:flex; justify-content:space-between; align-items:center; font-size:13.5px; border-bottom:1px dashed var(--rule); padding-bottom:6px; }

        .btn { display:inline-flex; align-items:center; gap:6px; font-size:13px; font-weight:500; border-radius:4px; padding:8px 14px; cursor:pointer; border:1px solid transparent; font-family:inherit; }
        .btn:disabled { opacity:0.45; cursor:not-allowed; }
        .btn-primary { background: var(--accent-teal); color:#fff; }
        .btn-ghost { background:#fff; border:1px solid var(--rule); color: var(--ink); }
        .icon-btn { background:none; border:none; cursor:pointer; color: var(--ink-soft); padding:4px; display:inline-flex; }
        .icon-btn:hover { color: var(--ink); }

        .panel-footer { display:flex; justify-content:space-between; align-items:center; gap:12px; margin-top:14px; flex-wrap:wrap; }
        .muted-note { font-size:12px; color: var(--ink-soft); }
        .empty-note { padding: 18px 4px; }

        .banner { display:flex; gap:8px; align-items:flex-start; border-radius:5px; padding:10px 12px; font-size:12.5px; margin: 10px 0; }
        .banner ul { margin:4px 0 0; padding-left:18px; }
        .banner-warning { background: var(--accent-amber-soft); color: var(--accent-amber); border:1px solid var(--accent-amber); }
        .banner-info { background: var(--info-soft); color: var(--ink-soft); border:1px solid var(--rule); }
        .banner-danger { background: var(--danger-soft); color: var(--danger); border:1px solid var(--danger); }

        .prov-tag { font-size:10.5px; font-weight:600; padding:2px 6px; border-radius:3px; display:inline-block; }
        .prov-user { background: var(--accent-indigo-soft); color: var(--accent-indigo); }
        .prov-ai { background: var(--accent-teal-soft); color: var(--accent-teal); }
        .prov-verified { background: var(--accent-teal-soft); color: var(--accent-teal); }
        .prov-edited { background: var(--accent-amber-soft); color: var(--accent-amber); }

        .status-chip { font-size:11.5px; font-weight:600; padding:2px 8px; border-radius:10px; color: var(--chip-color); background: color-mix(in srgb, var(--chip-color) 14%, white); border:1px solid var(--chip-color); }

        .conf-wrap { display:flex; align-items:center; gap:6px; }
        .conf-track { width:44px; height:5px; background: var(--rule); border-radius:3px; overflow:hidden; }
        .conf-fill { height:100%; background: var(--accent-teal); }
        .conf-pct { font-size:11px; color: var(--ink-soft); }

        .side-by-side { display:grid; grid-template-columns:1fr 1fr; gap:16px; margin-top:10px; }
        .side-by-side.compact { margin-top:8px; }
        @media (max-width: 720px) { .side-by-side { grid-template-columns:1fr; } }
        .pane-label { font-size:11px; text-transform:none; color: var(--ink-soft); font-weight:600; margin-bottom:6px; }
        .raw-text { background: var(--paper); border:1px solid var(--rule); border-radius:5px; padding:10px; font-size:12px; white-space:pre-wrap; max-height:340px; overflow:auto; margin:0; font-family:'IBM Plex Mono', monospace; }
        .test-edit-list { display:flex; flex-direction:column; gap:10px; }
        .test-edit-row { border:1px solid var(--rule); border-radius:5px; padding:8px; }
        .test-edit-grid { display:grid; grid-template-columns: 1.4fr 0.7fr 0.6fr 1fr 1fr auto; gap:6px; align-items:center; }
        @media (max-width: 720px) { .test-edit-grid { grid-template-columns: 1fr 1fr; } }
        .test-edit-meta { display:flex; justify-content:space-between; align-items:center; margin-top:6px; gap:8px; }

        .filter-row { display:flex; justify-content:space-between; align-items:center; gap:12px; margin-bottom:12px; flex-wrap:wrap; }
        .search-box { display:flex; align-items:center; gap:6px; border:1px solid var(--rule); border-radius:4px; padding:4px 8px; flex:1; min-width:160px; color: var(--ink-soft); }
        .filter-chips { display:flex; gap:6px; flex-wrap:wrap; }
        .filter-chip { font-size:12px; border:1px solid var(--rule); background:#fff; border-radius:12px; padding:4px 10px; cursor:pointer; color: var(--ink-soft); }
        .filter-chip.active { background: var(--accent-teal); color:#fff; border-color: var(--accent-teal); }

        .table-wrap { overflow-x:auto; }
        .table { width:100%; border-collapse:collapse; font-size:13px; }
        .table th { text-align:left; font-size:11px; color: var(--ink-soft); font-weight:600; border-bottom:1px solid var(--rule); padding:6px 8px; white-space:nowrap; }
        .table td { padding:8px; border-bottom:1px solid var(--rule); vertical-align:top; }
        .table tr.editing-row td { background: var(--info-soft); }
        .row-actions { display:flex; gap:4px; }

        .source-card { border-top:1px solid var(--rule); padding-top:10px; margin-top:10px; }
        .source-toggle { display:flex; align-items:center; gap:8px; background:none; border:none; cursor:pointer; font-size:13.5px; font-weight:500; color: var(--ink); padding:2px 0; width:100%; text-align:left; }
        .mini-list { list-style:none; margin:8px 0 0; padding:0; display:flex; flex-direction:column; gap:5px; font-size:12.5px; }

        .trend-group { margin-bottom:16px; }
        .trend-name { font-weight:600; font-size:14px; margin-bottom:6px; }
        .trend-row { display:flex; gap:14px; overflow-x:auto; padding-bottom:4px; }
        .trend-point { border:1px solid var(--rule); border-radius:5px; padding:8px 10px; min-width:110px; }
        .trend-date { font-size:11px; color: var(--ink-soft); }
        .trend-value { font-size:13.5px; display:flex; align-items:center; gap:4px; margin:3px 0; }
        .trend-up { color: var(--danger); } .trend-down { color: var(--accent-teal); } .trend-flat { color: var(--ink-soft); }

        .audit-list { list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:10px; }
        .audit-list li { display:flex; gap:8px; align-items:flex-start; color: var(--ink-soft); font-size:13px; }
        .audit-detail { color: var(--ink); }

        .summary-head { display:flex; align-items:center; gap:10px; flex-wrap:wrap; margin-bottom:10px; }
        .summary-text { font-family:'Source Serif 4', Georgia, serif; font-size:16px; line-height:1.6; }
        .discuss-list { font-size:13.5px; line-height:1.6; }
      `}</style>

      <div className="shell">
      <div className="hero">
        <img className="hero-bg" src="https://images.unsplash.com/photo-1576091160550-2173dba999ef?auto=format&fit=crop&w=1400&q=80" alt="Medical background"/>
        <div className="hero-overlay"/>
        <div className="hero-content">
          <h1>Personal Health Record</h1>
          <p>Securely organize patient details, medical reports, timelines and AI-assisted summaries.</p>
          <div className="hero-media">
            <img src="https://images.unsplash.com/photo-1584982751601-97dcc096659c?auto=format&fit=crop&w=400&q=80" alt="Doctor"/>
            <img src="https://images.unsplash.com/photo-1579684453423-f84349ef60b0?auto=format&fit=crop&w=400&q=80" alt="Lab"/>
            <video controls poster="https://images.unsplash.com/photo-1576091160399-112ba8d25d1d?auto=format&fit=crop&w=800&q=80">
              <source src="https://cdn.coverr.co/videos/coverr-doctor-working-on-a-laptop-1566307403317?download=1080p" type="video/mp4"/>
            </video>
          </div>
        </div>
      </div>

        <div className="masthead">
          <div className="wordmark">Clear<span>chart</span></div>
          {patient.name && (
            <div className="patient-chip"><strong>{patient.name}</strong> · {patient.mrn} · {patient.age || '—'}{patient.sex ? ', ' + patient.sex : ''}</div>
          )}
        </div>
        <div className="disclaimer">This tool organizes information you provide and extracts data from reports you paste in, for your own review. It does not diagnose, treat, or replace advice from a qualified clinician.</div>

        {patient.allergies.length > 0 && (
          <div className="allergy-strip"><ShieldAlert size={14} /> Allergy on file: {patient.allergies.join(', ')}</div>
        )}

        <div className="tabs">
          {TABS.map((t) => {
            const Icon = t.icon;
            return (
              <button type="button" key={t.key} className={'tab' + (activeTab === t.key ? ' active' : '')} onClick={() => setActiveTab(t.key)}>
                <Icon size={14} /> {t.label}
                {t.key === 'record' && conflictCount > 0 && <span className="badge">{conflictCount}</span>}
              </button>
            );
          })}
        </div>

        {activeTab === 'patient' && <PatientTab patient={patient} onSave={handleSavePatient} onLoadSample={handleLoadSamplePatient} />}
        {activeTab === 'add' && <AddReportTab existingTests={reports.flatMap((r) => r.tests.map((t) => ({ ...t, reportDate: r.reportDate, reportTitle: r.title })))} onCommit={handleCommitReport} />}
        {activeTab === 'record' && <RecordTab patient={patient} reports={reports} onUpdateTest={handleUpdateTest} onExport={handleExport} />}
        {activeTab === 'timeline' && <TimelineTab reports={reports} auditLog={auditLog} />}
        {activeTab === 'summary' && <SummaryTab patient={patient} reports={reports} summary={summary} onGenerate={handleGenerateSummary} />}
      </div>
    </div>
  );
}
