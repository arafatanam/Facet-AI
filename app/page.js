'use client';
import { useEffect, useState, useCallback, useRef } from 'react';
import { createClient } from '@supabase/supabase-js';

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://localhost', process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'x');
const col = () => '#002366';
const tierNames = { 'Below Average': 'Starting', Average: 'Developing', 'Above Average': 'Balanced', Attractive: 'Polished', 'Very Attractive': 'Refined', Elite: 'Distinctive' };
const tierName = label => tierNames[label] || label;
const FEATS = ['symmetry', 'jawline', 'cheekbones', 'eye_area', 'nose', 'lips', 'skin_quality', 'facial_harmony', 'dimorphism'];
const CATS = ['grooming', 'skincare', 'hair', 'fitness', 'posture', 'style', 'habits'];
const nice = s => (s || '').replace(/_/g, ' ').replace(/^./, c => c.toUpperCase());
const DISC = 'Scores reflect photo-based feedback, not personal value. Not medical advice.';
const LEGAL = {
  terms: 'Terms of Service. Final terms will be added before launch.',
  privacy: 'Photos are stored privately and sent to your configured AI provider for analysis. Delete them in Settings.',
  biometric: 'Face photos are processed by your configured AI provider to create your report.',
};

async function api(path, body) {
  const { data: { session } } = await sb.auth.getSession();
  const multipart = typeof FormData !== 'undefined' && body instanceof FormData;
  const r = await fetch('/api/' + path, {
    method: body ? 'POST' : 'GET',
    headers: {
      ...(multipart ? {} : { 'content-type': 'application/json' }),
      authorization: 'Bearer ' + (session?.access_token || ''),
    },
    body: body ? (multipart ? body : JSON.stringify(body)) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error || 'Something went wrong.'), { status: r.status });
  return j;
}

const Gauge = ({ v }) => {
  const r = 70, c = 2 * Math.PI * r;
  return <svg width="180" height="180" viewBox="0 0 180 180" role="img" aria-label={`Overall score ${v.toFixed(1)} out of 10`}>
    <circle cx="90" cy="90" r={r} fill="none" stroke="#454650" strokeWidth="12" />
    <circle cx="90" cy="90" r={r} fill="none" stroke={col(v)} strokeWidth="12" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - v / 10)} transform="rotate(-90 90 90)" />
    <text x="90" y="104" textAnchor="middle" fontSize="46" fontWeight="800" fill="#fff">{v.toFixed(1)}</text>
  </svg>;
};
const Bar = ({ v }) => <div className="bar"><i style={{ width: v * 10 + '%', background: col(v) }} /></div>;

function Onboard({ done }) {
  const [step, setStep] = useState(0), [a, setA] = useState({}), [ck, setCk] = useState([false, false, false]), [err, setErr] = useState('');
  const slides = [['Add two photos', 'Front and side views in even light.'], ['Get your report', 'Concise feedback and practical suggestions.'], ['Build a routine', 'Track steps that work for you.']];
  const Q = [['gender', 'Gender', ['male', 'female', 'other']], ['age_range', 'Age range', ['18 to 24', '25 to 34', '35 to 44', '45 plus']], ['main_goal', 'Focus', ['Facial balance', 'Skin', 'Hair', 'Personal style', 'Confidence']]];
  if (step < 3) return <div style={{ marginTop: 60 }}><h1>{slides[step][0]}</h1><p style={{ margin: '12px 0 24px' }}>{slides[step][1]}</p><button className="btn" onClick={() => setStep(step + 1)}>{step === 2 ? 'Get started' : 'Next'}</button></div>;
  if (step < 6) { const [k, t, o] = Q[step - 3]; return <div><h1>{t}</h1>{o.map(x => <button key={x} className={'opt' + (a[k] === x ? ' on' : '')} onClick={() => { setA({ ...a, [k]: x }); setStep(step + 1); }}>{nice(x)}</button>)}</div>; }
  const labels = ['I am 18 or older.', 'I agree to the Terms and Privacy Policy.', 'I consent to storing my photos and sending them to the configured AI provider for analysis.'];
  return <div><h1>Before you scan</h1>
    {labels.map((l, i) => <label key={i} className="card row" style={{ cursor: 'pointer' }}><span>{l}</span><input type="checkbox" checked={ck[i]} onChange={() => setCk(ck.map((x, j) => j === i ? !x : x))} /></label>)}
    {err && <div className="err">{err}</div>}
    <button className="btn" disabled={!ck.every(Boolean)} onClick={async () => { try { await api('profile', { ...a, age_confirmed: true, consent_accepted: true }); done(); } catch (e) { setErr(e.message); } }}>Continue</button>
  </div>;
}

function Paywall({ me, back, done }) {
  const [plan, setPlan] = useState('weekly_trial'), [busy, setBusy] = useState(false), [err, setErr] = useState('');
  const go = async () => { setBusy(true); try { const r = await api('subscribe', { plan }); if (r.url) location.href = r.url; else done(); } catch (e) { setErr(e.message); setBusy(false); } };
  return <div>
    <h1>Unlock the full report.</h1>
    <div className="card">{['Feature report', 'Personalized plan', 'Daily coaching', 'Scan history'].map(x => <p key={x} style={{ color: '#fff' }}>{x}</p>)}</div>
    <button className={'opt' + (plan === 'weekly_trial' ? ' on' : '')} onClick={() => setPlan('weekly_trial')}><b>3-day trial, then $4.99 per week</b></button>
    <button className={'opt' + (plan === 'weekly' ? ' on' : '')} onClick={() => setPlan('weekly')}><b>$6.99 per week</b>, no trial</button>
    {err && <div className="err">{err}</div>}
    <button className="btn" disabled={busy} onClick={go}>{plan === 'weekly_trial' ? 'Start free trial' : 'Subscribe'}</button>
    {me.test && <p className="tag">Test mode: no payment taken</p>}
    <p style={{ fontSize: 12 }}>Renews weekly. Cancel anytime in Settings.</p>
    <button className="btn alt" onClick={back}>Not now</button>
  </div>;
}

function Scan({ go, me }) {
  const [f, setF] = useState({}), [prev, setPrev] = useState({}), [err, setErr] = useState('');
  const pick = (k, file) => {
    if (!file) return;
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return setErr('Use a JPG, PNG or WEBP photo.');
    if (file.size > 10 * 1024 * 1024) return setErr('Photo is over 10 MB.');
    setErr(''); setF(x => ({ ...x, [k]: file })); setPrev(x => ({ ...x, [k]: URL.createObjectURL(file) }));
  };
  const Slot = ({ k, label }) => <label className="card" style={{ display: 'block', cursor: 'pointer', textAlign: 'center' }}>
    {prev[k] ? <img src={prev[k]} alt={label} style={{ width: '100%', height: 200, objectFit: 'cover', borderRadius: 12 }} /> : <div style={{ height: 200, display: 'grid', placeItems: 'center' }}><span className="g">Tap to add<br /><b style={{ color: '#fff' }}>{label}</b></span></div>}
    <input type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={e => pick(k, e.target.files[0])} />
  </label>;
  return <div><h1>Scan</h1><p>Use front and side photos in even light. Avoid filters and glasses.</p>
    <Slot k="front" label="Front photo" /><Slot k="side" label="Side profile photo" />
    {err && <div className="err">{err}</div>}
    <button className="btn" disabled={!f.front || !f.side} onClick={() => go('analyzing', f)}>Analyze my face</button>
  </div>;
}

function Analyzing({ files, done, fail, paywall }) {
  const [err, setErr] = useState(''), ran = useRef(false);
  const run = useCallback(async () => {
    setErr('');
    try {
      const paths = {};
      for (const k of ['front', 'side']) {
        const { path, token } = await api('upload', {
          kind: k,
          size: files[k].size,
          contentType: files[k].type,
        });
        const { error } = await sb.storage.from('photos').uploadToSignedUrl(path, token, files[k], {
          contentType: files[k].type,
        });
        if (error) throw new Error(`Photo upload failed: ${error.message}`);
        paths[k] = path;
      }
      const r = await api('analyze', paths); done(r.id);
    } catch (e) { if (e.status === 402) paywall(); else setErr(e.message); }
  }, [files]);
  useEffect(() => { if (!ran.current) { ran.current = true; run(); } }, [run]);
  return <div><div className="scanbox"><img src={URL.createObjectURL(files.front)} alt="Your front photo" />{!err && <div className="line" />}</div>
    {err ? <><div className="err" role="alert">{err}</div><button className="btn" onClick={run}>Retry</button><button className="btn alt" onClick={fail}>Choose different photos</button></> : <h2>Analyzing photos</h2>}
  </div>;
}

function shareCard(s) {
  const c = document.createElement('canvas'); c.width = 600; c.height = 800; const x = c.getContext('2d');
  x.fillStyle = '#0B0B10'; x.fillRect(0, 0, 600, 800); x.fillStyle = '#16161F'; x.fillRect(30, 30, 540, 740);
  x.fillStyle = '#fff'; x.font = '800 36px sans-serif'; x.fillText('Facet AI', 60, 100);
  x.fillStyle = col(s.overall_score); x.fillRect(50, 170, 350, 150);
  x.fillStyle = '#fff'; x.font = '800 150px sans-serif'; x.fillText(s.overall_score.toFixed(1), 60, 300);
  x.fillStyle = '#fff'; x.font = '700 40px sans-serif'; x.fillText(tierName(s.tier_label), 60, 370);
  if (s.feature_scores) Object.entries(s.feature_scores).sort((a, b) => b[1].score - a[1].score).slice(0, 3).forEach(([k, v], i) => { x.fillStyle = '#fff'; x.font = '28px sans-serif'; x.fillText(`${nice(k)}  ${v.score.toFixed(1)}`, 60, 500 + i * 60); });
  x.fillStyle = '#fff'; x.font = '600 24px sans-serif'; x.fillText('Facet AI | Personal report', 60, 730);
  const a = document.createElement('a'); a.href = c.toDataURL('image/png'); a.download = 'facet-score.png'; a.click();
}

function Results({ s, go }) {
  if (!s) return <p>Loading...</p>;
  const top = (s.plan || []).slice(0, 3);
  return <div>
    <div className="card" style={{ textAlign: 'center' }}><Gauge v={s.overall_score} /><h1>{tierName(s.tier_label)}</h1>{s.potential_score != null && <p>Potential {s.potential_score.toFixed(1)}</p>}
      <button className="btn sm" onClick={() => shareCard(s)}>Share score card</button></div>
    {s.locked ? <div className="card"><p>Unlock feature details and your personal plan.</p><button className="btn sm" onClick={() => go('paywall')}>View plans</button></div> : <>
      <p style={{ marginTop: 12 }}>{s.summary}</p>
      {top.length > 0 && <><h2>Priority actions</h2>{top.map(p => <div className="card" key={p.id}><h3>{p.title}</h3><p>{p.reason}</p></div>)}</>}
      <h2>Feature scores <span className="tag">Estimate</span></h2>
      {FEATS.map(f => s.feature_scores[f] && <div className="card" key={f}><div className="row"><h3>{nice(f)}</h3><b className="score">{s.feature_scores[f].score.toFixed(1)}</b></div><Bar v={s.feature_scores[f].score} /><p style={{ marginTop: 6 }}>{s.feature_scores[f].verdict}</p></div>)}
      <h2>Face profile</h2><div className="card">{Object.entries(s.face_profile || {}).map(([k, v]) => <div className="row" key={k}><span className="g">{nice(k)}</span><b>{nice(String(v))}</b></div>)}</div>
      <h2>Strengths</h2><div className="card">{(s.strengths || []).map(x => <p key={x} style={{ color: '#fff' }}>{x}</p>)}</div>
      <h2>Areas to develop</h2><div className="card">{(s.weaknesses || []).map(x => <p key={x} style={{ color: '#fff' }}>{x}</p>)}</div>
      <button className="btn" onClick={() => go('plan')}>Open improvement plan</button><button className="btn alt" onClick={() => go('coach')}>Ask Coach Vee</button></>}
    <p style={{ fontSize: 12, marginTop: 16 }}>{DISC}</p>
  </div>;
}

function Plan({ s, go, setS }) {
  if (!s) return <div><h1>Plan</h1><p>Run a scan to get your plan.</p><button className="btn" onClick={() => go('scan')}>Scan now</button></div>;
  if (s.locked) return <div><h1>Plan</h1><div className="card"><p>Your ranked plan is part of the full report.</p><button className="btn" onClick={() => go('paywall')}>Unlock now</button></div></div>;
  const plan = s.plan || [], pct = plan.length ? Math.round(plan.filter(p => p.completed).length / plan.length * 100) : 0;
  const tog = async p => { const completed = !p.completed; setS({ ...s, plan: plan.map(x => x.id === p.id ? { ...x, completed } : x) }); await api('plan/toggle', { id: p.id, completed }); };
  return <div><h1>Plan</h1><div className="row"><span className="g">{pct}% done</span></div><Bar v={pct / 10} />
    {CATS.filter(c => plan.some(p => p.category === c)).map(c => <div key={c}><h2>{nice(c)}</h2>
      {plan.filter(p => p.category === c).map(p => <label className="card" key={p.id} style={{ display: 'flex', gap: 12, cursor: 'pointer' }}><input type="checkbox" checked={p.completed} onChange={() => tog(p)} aria-label={p.title} />
        <div><h3>{p.title}</h3><p>{p.reason}</p><p style={{ marginTop: 4 }}><span className="tag">Effort {p.effort}</span> <span className="tag">Impact {p.impact}</span> <span className="tag">{p.time_to_result}</span></p></div></label>)}</div>)}
  </div>;
}

function Coach({ me, go }) {
  const [msgs, setMsgs] = useState([]), [t, setT] = useState(''), [busy, setBusy] = useState(false), end = useRef();
  useEffect(() => { if (me.paid) api('chat').then(r => setMsgs(r.messages)).catch(() => {}); }, [me.paid]);
  useEffect(() => { end.current?.scrollIntoView({ behavior: 'smooth' }); }, [msgs, busy]);
  if (!me.paid) return <div><h1>Coach Vee</h1><div className="card"><p>Coaching is part of the full report.</p><button className="btn sm" onClick={() => go('paywall')}>View plans</button></div></div>;
  const send = async text => { if (!text.trim() || busy) return; setT(''); setBusy(true); setMsgs(m => [...m, { role: 'user', content: text }]);
    try { const r = await api('coach', { message: text }); setMsgs(m => [...m, { role: 'assistant', content: r.reply }]); } catch (e) { setMsgs(m => [...m, { role: 'assistant', content: e.message }]); } setBusy(false); };
  return <div><h1>Coach Vee</h1>
    {!msgs.length && <div className="chips">{['Facial balance', 'Haircut ideas', 'Skincare basics', 'Set a first step'].map(c => <button key={c} className="chip" onClick={() => send(c)}>{c}</button>)}</div>}
    {msgs.map((m, i) => <div key={i} className={'msg ' + (m.role === 'user' ? 'u' : 'a')}>{m.content}</div>)}
    {busy && <div className="msg a dots"><span>.</span><span>.</span><span>.</span></div>}<div ref={end} />
    <div className="row" style={{ marginTop: 12 }}><input type="text" value={t} placeholder="Ask Coach Vee" aria-label="Message" onChange={e => setT(e.target.value)} onKeyDown={e => e.key === 'Enter' && send(t)} /><button className="btn sm" onClick={() => send(t)}>Send</button></div>
  </div>;
}

function History({ go, open, me }) {
  const [list, setList] = useState(null), [cmp, setCmp] = useState(null);
  useEffect(() => { api('scans').then(r => setList(r.scans)); }, []);
  if (!list) return <p>Loading...</p>;
  const pts = [...list].reverse(), W = 440, H = 120, xs = i => pts.length < 2 ? W / 2 : 10 + i * (W - 20) / (pts.length - 1), ys = v => H - 10 - v * (H - 20) / 10;
  const compare = async () => { const [a, b] = await Promise.all(list.slice(0, 2).map(s => api('scan?id=' + s.id))); setCmp([a.scan, b.scan]); };
  return <div><h1>History</h1>
    {list.length === 0 && <p>No scans yet.</p>}
    {me.paid && pts.length > 1 && <div className="card chart"><svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Overall score over time"><polyline fill="none" stroke="#002366" strokeWidth="3" points={pts.map((p, i) => `${xs(i)},${ys(p.overall)}`).join(' ')} />{pts.map((p, i) => <circle key={p.id} cx={xs(i)} cy={ys(p.overall)} r="4" fill="#002366" />)}</svg></div>}
    {list.map(s => <button key={s.id} className="card row opt" onClick={() => open(s.id)}><span className="row" style={{ gap: 12 }}>{s.thumb ? <img className="thumb" src={s.thumb} alt="" /> : <span className="thumb" />}<span>{new Date(s.created_at).toLocaleDateString()}<br /><span className="g">{tierName(s.tier)}</span></span></span><b className="score">{Number(s.overall).toFixed(1)}</b></button>)}
    {me.paid && list.length > 1 && !cmp && <button className="btn alt" onClick={compare}>Compare last two scans</button>}
    {cmp && <div className="card"><h3>Latest comparison</h3>{FEATS.map(f => { const d = (cmp[0].feature_scores?.[f]?.score ?? 0) - (cmp[1].feature_scores?.[f]?.score ?? 0); return <div className="row" key={f}><span>{nice(f)}</span><b className="score">{d >= 0 ? '+' : ''}{d.toFixed(1)}</b></div>; })}</div>}
    {!me.paid && list.length > 0 && <button className="btn" onClick={() => go('paywall')}>Unlock history and compare</button>}
  </div>;
}

function Settings({ me, reload, go }) {
  const [msg, setMsg] = useState(''), [legal, setLegal] = useState(null);
  const p = me.profile || {};
  const set = async (k, v) => { await api('settings', { [k]: v }); reload(); };
  const del = async mode => { if (!confirm(mode === 'account' ? 'Delete your data and guest session?' : 'Delete all your photos?')) return; await api('delete', { mode }); if (mode === 'account') await sb.auth.signOut(); else setMsg('Photos deleted.'); };
  if (legal) return <div><button className="btn alt" onClick={() => setLegal(null)}>Back</button><h2>{nice(legal)}</h2><p>{LEGAL[legal]}</p></div>;
  return <div><h1>Profile</h1><p>{me.isAnonymous ? 'Guest session' : me.email}</p>
    {[['gender', ['male', 'female', 'other']], ['age_range', ['18 to 24', '25 to 34', '35 to 44', '45 plus']], ['main_goal', ['Facial balance', 'Skin', 'Hair', 'Personal style', 'Confidence']]].map(([k, o]) => <div key={k}><h2>{nice(k)}</h2><div className="chips">{o.map(x => <button key={x} className={'chip' + (p[k] === x ? ' on' : '')} style={p[k] === x ? { background: '#002366' } : {}} onClick={() => set(k, x)}>{nice(x)}</button>)}</div></div>)}
    <h2>Subscription</h2><div className="card"><div className="row"><span>{me.sub ? `${nice(me.sub.plan)} · ${me.sub.status}` : 'Free'}</span>{me.sub?.current_period_end && <span className="g">Renews {new Date(me.sub.current_period_end).toLocaleDateString()}</span>}</div>
      {me.paid ? <button className="btn alt" onClick={async () => { await api('cancel', {}); reload(); }}>Cancel subscription</button> : <button className="btn" onClick={() => go('paywall')}>Upgrade</button>}</div>
    <h2>Privacy</h2><div className="card">
      <label className="row"><span>Keep photos for progress tracking</span><input type="checkbox" checked={!!p.keep_photos} onChange={e => set('keep_photos', e.target.checked)} /></label>
      <button className="btn alt" onClick={() => del('photos')}>Delete all photos</button><button className="btn alt" onClick={() => del('account')}>Delete my data and session</button>{msg && <p>{msg}</p>}</div>
    <h2>Legal and help</h2><div className="chips">{Object.keys(LEGAL).map(k => <button key={k} className="chip" onClick={() => setLegal(k)}>{nice(k)}</button>)}<a className="chip" href="mailto:support@example.com">Contact support</a><a className="chip" href="https://findahelpline.com" target="_blank" rel="noreferrer">Find a helpline</a></div>
  </div>;
}

export default function App() {
  const [sess, setSess] = useState(), [me, setMe] = useState(null), [v, setV] = useState('boot'), [scan, setScan] = useState(null), [files, setFiles] = useState(null), [from, setFrom] = useState('home'), [loadError, setLoadError] = useState(''), [sessionError, setSessionError] = useState('');
  const startGuestSession = useCallback(async () => {
    setSessionError('');
    try {
      const { data, error } = await sb.auth.getSession();
      if (error) throw error;
      if (data.session) {
        setSess(data.session);
        return;
      }
      const { data: guest, error: guestError } = await sb.auth.signInAnonymously();
      if (guestError) throw guestError;
      if (!guest.session) throw new Error('Could not start a guest session.');
      setSess(guest.session);
    } catch (error) {
      setSess(null);
      setSessionError(error instanceof Error ? error.message : 'Could not start a guest session.');
    }
  }, []);
  useEffect(() => {
    const { data: l } = sb.auth.onAuthStateChange((event, s) => {
      setSess(s);
      if (event === 'SIGNED_OUT') queueMicrotask(startGuestSession);
    });
    startGuestSession();
    return () => l.subscription.unsubscribe();
  }, [startGuestSession]);
  const load = useCallback(async (next) => {
    setLoadError('');
    const m = await api('me');
    const r = await api('scan'); setScan(r.scan);
    setMe(m);
    setV(x => !m.profile?.onboarded ? 'welcome' : (x === 'boot' || x === 'welcome') ? (next || 'home') : (next || x));
  }, []);
  useEffect(() => {
    if (sess) load().catch(e => setLoadError(e.message));
    else if (sess === null) { setMe(null); setV('boot'); }
  }, [sess, load]);
  const open = async id => { const r = await api('scan?id=' + id); setScan(r.scan); setV('results'); };
  const go = (to, f) => { if (to === 'analyzing') setFiles(f); if (to === 'paywall') setFrom(v); setV(to); };
  const tab = t => { setV(t); if (t === 'plan' || t === 'results') api('scan').then(r => setScan(r.scan)); };
  if (sess === undefined) return <div className="app"><p>Starting a private guest session...</p></div>;
  if (!sess) return <div className="app"><h1>Could not start Facet AI</h1><p className="err" role="alert">{sessionError}</p><button className="btn" onClick={startGuestSession}>Try again</button></div>;
  if (!me) return <div className="app">{loadError ? <><h1>Could not load Facet AI</h1><p className="err" role="alert">{loadError}</p><button className="btn" onClick={() => load().catch(e => setLoadError(e.message))}>Try again</button></> : <p>Loading...</p>}</div>;
  if (v === 'welcome') return <div className="app"><Onboard done={() => load('scan')} /></div>;
  if (v === 'paywall') return <div className="app"><Paywall me={me} back={() => setV(from === 'paywall' ? 'home' : from)} done={async () => { await load(from === 'paywall' ? 'home' : from); }} /></div>;
  if (v === 'analyzing') return <div className="app"><Analyzing files={files} done={id => open(id).then(() => load('results'))} fail={() => setV('scan')} paywall={() => go('paywall')} /></div>;
  const pct = scan?.plan?.length ? Math.round(scan.plan.filter(p => p.completed).length / scan.plan.length * 100) : null;
  const old = scan && (Date.now() - new Date(scan.created_at)) > 30 * 864e5;
  return <div className="app">
    {v === 'home' && <div><h1>Home</h1>
      {scan ? <div className="card" style={{ textAlign: 'center' }}><Gauge v={scan.overall_score} /><h3>{tierName(scan.tier_label)}</h3>{pct != null && <p>Plan {pct}% done</p>}<button className="btn" onClick={() => open(scan.id)}>View results</button></div> : <div className="card"><p>No report yet. Start with two photos.</p></div>}
      {old && <div className="card"><p>Your last scan is over 30 days old. Rescan to track progress.</p></div>}
      <button className="btn" onClick={() => setV('scan')}>{scan ? 'Rescan' : 'Start your first scan'}</button><button className="btn alt" onClick={() => setV('history')}>History and progress</button></div>}
    {v === 'scan' && <Scan go={go} me={me} />}
    {v === 'results' && <Results s={scan} go={go} />}
    {v === 'plan' && <Plan s={scan} go={go} setS={setScan} />}
    {v === 'coach' && <Coach me={me} go={go} />}
    {v === 'history' && <History go={go} open={open} me={me} />}
    {v === 'settings' && <Settings me={me} reload={() => load()} go={go} />}
    <nav className="tabs" aria-label="Main">{[['home', 'Home'], ['scan', 'Scan'], ['plan', 'Plan'], ['coach', 'Coach'], ['settings', 'Profile']].map(([k, l]) => <button key={k} className={v === k ? 'on' : ''} onClick={() => tab(k)}>{l}</button>)}</nav>
  </div>;
}
