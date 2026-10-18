import { NextResponse } from "next/server";
import Stripe from "stripe";
import { admin, getUser, isPaid } from "@/lib/server";
import {
  ANALYSIS_PROMPT,
  SHORT_PROMPT,
  COACH_PROMPT,
  WEIGHTS,
  tierFor,
  DISTRESS,
} from "@/lib/prompts";

export const maxDuration = 60;
const J = (o, status = 200) => NextResponse.json(o, { status });
const E = (status, error) => J({ error }, status);
const TEST = () => process.env.TEST_MODE === "true";
const AI_NOT_CONFIGURED = "AI is not configured. Add GROQ_API_KEY to .env.local, then restart npm run dev.";
const AI_CONFIGURED = () =>
  !!process.env.GROQ_API_KEY ||
  !!process.env.ANTHROPIC_API_KEY ||
  process.env.MOCK_AI === "true";

function mockReply(system) {
  if (system.includes("Coach Vee"))
    return "Start with sleep and a daily SPF. Your skin scores lowest. Next step: apply SPF 30 tomorrow morning.";
  const f = {};
  Object.keys(WEIGHTS).forEach((k, i) => {
    f[k] = {
      score: 4.5 + ((i * 7) % 30) / 10,
      verdict: `Mock verdict for ${k}.`,
    };
  });
  const cats = [
    "grooming",
    "skincare",
    "hair",
    "fitness",
    "posture",
    "style",
    "habits",
    "skincare",
  ];
  return JSON.stringify({
    potential_score: 7.2,
    summary: "Mock result for testing.",
    feature_scores: f,
    face_profile: {
      face_shape: "oval",
      eye_type: "almond",
      canthal_tilt: "neutral",
      jaw_type: "soft",
      skin_type: "normal",
    },
    strengths: [
      "Mock strength one",
      "Mock strength two",
      "Mock strength three",
    ],
    weaknesses: [
      "Mock weakness one",
      "Mock weakness two",
      "Mock weakness three",
    ],
    plan: cats.map((c, i) => ({
      category: c,
      title: `Mock action ${i + 1}`,
      reason: "Mock reason.",
      effort: "low",
      impact: "medium",
      time_to_result: "4 weeks",
      priority: i + 1,
    })),
  });
}

async function groqReply(system, messages, max, json) {
  const groqMessages = [
    { role: "system", content: system },
    ...messages.map(({ role, content }) => ({
      role,
      content: Array.isArray(content)
        ? content.map((part) => {
            if (part.type === "text") return { type: "text", text: part.text };
            if (part.type === "image" && part.source?.type === "base64") {
              return {
                type: "image_url",
                image_url: {
                  url: `data:${part.source.media_type};base64,${part.source.data}`,
                },
              };
            }
            throw new Error("Unsupported content sent to Groq.");
          })
        : content,
    })),
  ];
  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      authorization: `Bearer ${process.env.GROQ_API_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.GROQ_MODEL || "qwen/qwen3.8-27b",
      messages: groqMessages,
      max_completion_tokens: max,
      temperature: 0.7,
      ...(json ? { response_format: { type: "json_object" } } : {}),
    }),
  });
  const raw = await response.text();
  let result;
  try {
    result = JSON.parse(raw);
  } catch {
    throw new Error(`Groq returned an invalid response (${response.status}).`);
  }
  if (!response.ok)
    throw new Error(result.error?.message || `Groq request failed (${response.status}).`);
  const text = result.choices?.[0]?.message?.content;
  if (typeof text !== "string" || !text.trim())
    throw new Error("Groq returned an empty response.");
  return text;
}

async function aiReply(system, messages, max = 2500, { json = false } = {}) {
  if (process.env.GROQ_API_KEY) return groqReply(system, messages, max, json);
  if (process.env.ANTHROPIC_API_KEY) {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6",
        max_tokens: max,
        system,
        messages,
      }),
    });
    const raw = await r.text();
    let result;
    try {
      result = JSON.parse(raw);
    } catch {
      throw new Error(`Anthropic returned an invalid response (${r.status}).`);
    }
    if (!r.ok)
      throw new Error(result.error?.message || `Anthropic request failed (${r.status}).`);
    const text = (result.content || []).map((c) => c.text || "").join("");
    if (!text.trim()) throw new Error("Anthropic returned an empty response.");
    return text;
  }
  if (process.env.MOCK_AI === "true") return mockReply(system);
  throw new Error("AI is not configured. Add GROQ_API_KEY to .env.local, then restart npm run dev.");
}
const parse = (t) => {
  try {
    return JSON.parse(t.slice(t.indexOf("{"), t.lastIndexOf("}") + 1));
  } catch {
    return null;
  }
};
const valid = (r) =>
  r &&
  (r.error ||
    (r.feature_scores &&
      Object.keys(WEIGHTS).every(
        (k) => typeof r.feature_scores[k]?.score === "number",
      ) &&
      Array.isArray(r.plan)));
const clamp = (n) => Math.max(0, Math.min(10, Number(n) || 0));

async function analyze(u, b) {
  if (!AI_CONFIGURED()) return E(503, AI_NOT_CONFIGURED);
  const db = admin();
  const paid = await isPaid(u.email);
  const { count: total } = await db
    .from("scans")
    .select("id", { count: "exact", head: true })
    .eq("user_email", u.email);
  if (!paid && total >= 1) return E(402, "paywall");
  const since = new Date(Date.now() - 7 * 864e5).toISOString();
  const { count: week } = await db
    .from("scans")
    .select("id", { count: "exact", head: true })
    .eq("user_email", u.email)
    .gte("created_at", since);
  if (week >= 5)
    return E(429, "Weekly limit of 5 scans reached. Come back later.");
  const { data: p } = await db
    .from("profiles")
    .select("*")
    .eq("user_email", u.email)
    .maybeSingle();
  if (!p?.consent_at || !p.age_confirmed)
    return E(403, "Consent and age confirmation required.");
  const imgs = [];
  for (const path of [b.front, b.side]) {
    if (!path?.startsWith(u.id + "/")) return E(400, "Bad photo path.");
    const { data } = await db.storage.from("photos").download(path);
    if (!data) return E(400, "Photo not found.");
    imgs.push({
      type: "image",
      source: {
        type: "base64",
        media_type: data.type || "image/jpeg",
        data: Buffer.from(await data.arrayBuffer()).toString("base64"),
      },
    });
  }
  const ctx = {
    type: "text",
    text: `Image 1 is the front photo. Image 2 is the side profile. Gender: ${p.gender}. Age range: ${p.age_range}. Goal: ${p.main_goal}.`,
  };
  let res = null;
  for (const sys of [ANALYSIS_PROMPT, SHORT_PROMPT]) {
    let response;
    try {
      response = await aiReply(sys, [{ role: "user", content: [...imgs, ctx] }], 2500, { json: true });
    } catch (error) {
      if (error instanceof Error) return E(502, error.message);
      throw error;
    }
    res = parse(response);
    if (valid(res)) break;
    res = null;
  }
  if (!res)
    return E(
      502,
      "Analysis failed. No scan was used. Retake your photos and try again.",
    );
  if (res.error) return E(422, res.error);
  let overall = 0;
  for (const k in WEIGHTS) {
    res.feature_scores[k].score = clamp(res.feature_scores[k].score);
    overall += WEIGHTS[k] * res.feature_scores[k].score;
  }
  overall = Math.round(overall * 10) / 10;
  const [tier, psl] = tierFor(overall);
  const { data: scan } = await db
    .from("scans")
    .insert({
      user_email: u.email,
      front_path: b.front,
      side_path: b.side,
      overall,
      potential: clamp(res.potential_score),
      tier,
      psl,
      result: {
        summary: res.summary,
        feature_scores: res.feature_scores,
        face_profile: res.face_profile,
        strengths: res.strengths,
        weaknesses: res.weaknesses,
      },
    })
    .select("id")
    .single();
  const plan = res.plan.slice(0, 12).map((x, i) => ({
    scan_id: scan.id,
    user_email: u.email,
    category: x.category,
    title: x.title,
    reason: x.reason,
    effort: x.effort,
    impact: x.impact,
    time_to_result: x.time_to_result,
    priority: x.priority || i + 1,
  }));
  await db.from("plan_items").insert(plan);
  return J({ id: scan.id });
}

async function getScan(u, id) {
  const db = admin();
  let q = db.from("scans").select("*").eq("user_email", u.email);
  q = id
    ? q.eq("id", id)
    : q.order("created_at", { ascending: false }).limit(1);
  const { data: s } = await q.maybeSingle();
  if (!s) return J({ scan: null });
  const paid = await isPaid(u.email);
  const out = {
    id: s.id,
    created_at: s.created_at,
    overall_score: s.overall,
    tier_label: s.tier,
    psl_tier: s.psl,
    locked: !paid,
  };
  if (paid) {
    const { data: plan } = await db
      .from("plan_items")
      .select("*")
      .eq("scan_id", s.id)
      .order("priority");
    Object.assign(out, { potential_score: s.potential, ...s.result, plan });
  }
  return J({ scan: out });
}

async function coach(u, b) {
  if (!(await isPaid(u.email))) return E(402, "paywall");
  const db = admin();
  const day = new Date();
  day.setUTCHours(0, 0, 0, 0);
  const { count } = await db
    .from("chat_messages")
    .select("id", { count: "exact", head: true })
    .eq("user_email", u.email)
    .eq("role", "user")
    .gte("created_at", day.toISOString());
  if (count >= 50) return E(429, "Daily limit of 50 messages reached.");
  const { data: s } = await db
    .from("scans")
    .select("*")
    .eq("user_email", u.email)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!s) return E(400, "Run a scan first.");
  const [{ data: plan }, { data: p }, { data: hist }] = await Promise.all([
    db
      .from("plan_items")
      .select("title,category,completed")
      .eq("scan_id", s.id),
    db
      .from("profiles")
      .select("gender,age_range,main_goal")
      .eq("user_email", u.email)
      .maybeSingle(),
    db
      .from("chat_messages")
      .select("role,content")
      .eq("user_email", u.email)
      .order("created_at", { ascending: false })
      .limit(10),
  ]);
  const context = JSON.stringify({
    overall: s.overall,
    tier: s.tier,
    ...s.result,
    open_plan: plan.filter((x) => !x.completed),
    profile: p,
  });
  const system = `${COACH_PROMPT}\n\nUser data: ${context}${DISTRESS.test(b.message) ? "\n\nThe user may be distressed. Be supportive, not blunt." : ""}`;
  const messages = [
    ...(hist || [])
      .reverse()
      .map((m) => ({ role: m.role, content: m.content })),
    { role: "user", content: String(b.message).slice(0, 1000) },
  ];
  let reply;
  try {
    reply = await aiReply(system, messages, 500);
  } catch (error) {
    if (error instanceof Error) return E(502, error.message);
    throw error;
  }
  await db.from("chat_messages").insert([
    { user_email: u.email, scan_id: s.id, role: "user", content: b.message },
    { user_email: u.email, scan_id: s.id, role: "assistant", content: reply },
  ]);
  return J({ reply });
}

async function subscribe(u, b, req) {
  const trial = b.plan === "weekly_trial";
  const db = admin();
  if (TEST()) {
    await db.from("subscriptions").upsert({
      user_email: u.email,
      plan: b.plan,
      status: trial ? "trialing" : "active",
      current_period_end: new Date(
        Date.now() + (trial ? 3 : 7) * 864e5,
      ).toISOString(),
    });
    return J({ ok: true });
  }
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const origin = new URL(req.url).origin;
  const s = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer_email: u.email,
    metadata: { email: u.email, plan: b.plan },
    line_items: [
      {
        price: trial
          ? process.env.STRIPE_PRICE_WEEKLY_TRIAL
          : process.env.STRIPE_PRICE_WEEKLY,
        quantity: 1,
      },
    ],
    subscription_data: trial ? { trial_period_days: 3 } : undefined,
    success_url: origin + "/?paid=1",
    cancel_url: origin + "/",
  });
  return J({ url: s.url });
}

async function webhook(req) {
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  let ev;
  try {
    ev = stripe.webhooks.constructEvent(
      await req.text(),
      req.headers.get("stripe-signature"),
      process.env.STRIPE_WEBHOOK_SECRET,
    );
  } catch {
    return E(400, "Bad signature");
  }
  const db = admin();
  const map = (s) =>
    s === "trialing"
      ? "trialing"
      : s === "active"
        ? "active"
        : s === "canceled"
          ? "cancelled"
          : "expired";
  const o = ev.data.object;
  if (ev.type === "checkout.session.completed") {
    const sub = await stripe.subscriptions.retrieve(o.subscription);
    await db.from("subscriptions").upsert({
      user_email: o.metadata.email,
      plan: o.metadata.plan,
      status: map(sub.status),
      stripe_customer_id: o.customer,
      stripe_subscription_id: sub.id,
      current_period_end: new Date(sub.current_period_end * 1000).toISOString(),
    });
  } else if (
    ev.type === "invoice.paid" ||
    ev.type.startsWith("customer.subscription.")
  ) {
    const id = ev.type === "invoice.paid" ? o.subscription : o.id;
    const sub = await stripe.subscriptions.retrieve(id);
    await db
      .from("subscriptions")
      .update({
        status: map(sub.status),
        current_period_end: new Date(
          sub.current_period_end * 1000,
        ).toISOString(),
      })
      .eq("stripe_subscription_id", id);
  }
  return J({ ok: true });
}

async function wipePhotos(db, email) {
  const { data } = await db
    .from("scans")
    .select("id,front_path,side_path")
    .eq("user_email", email);
  const files = (data || [])
    .flatMap((s) => [s.front_path, s.side_path])
    .filter(Boolean);
  if (files.length) await db.storage.from("photos").remove(files);
  await db
    .from("scans")
    .update({ front_path: null, side_path: null })
    .eq("user_email", email);
}

async function handle(req, ctx, method) {
  const [a, b] = (await ctx.params).path;
  if (a === "webhook") return webhook(req);
  if (a === "cron") {
    if (
      req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`
    )
      return E(401, "No");
    const db = admin();
    const old = new Date(Date.now() - 30 * 864e5).toISOString();
    const { data: keep } = await db
      .from("profiles")
      .select("user_email")
      .eq("keep_photos", true);
    const { data } = await db
      .from("scans")
      .select("id,front_path,side_path,user_email")
      .lt("created_at", old)
      .not("front_path", "is", null);
    const rows = (data || []).filter(
      (s) => !(keep || []).some((k) => k.user_email === s.user_email),
    );
    const files = rows.flatMap((s) => [s.front_path, s.side_path]);
    if (files.length) {
      await db.storage.from("photos").remove(files);
      await db
        .from("scans")
        .update({ front_path: null, side_path: null })
        .in(
          "id",
          rows.map((r) => r.id),
        );
    }
    return J({ deleted: rows.length });
  }
  const u = await getUser(req);
  if (!u) return E(401, "Sign in required.");
  const db = admin();
  const body = method === "POST" ? await req.json().catch(() => ({})) : {};
  if (method === "POST" && a === "upload") {
    if (!AI_CONFIGURED()) return E(503, AI_NOT_CONFIGURED);
    const kind = body.kind;
    const contentType = body.contentType;
    const size = Number(body.size);
    if (!["front", "side"].includes(kind))
      return E(400, "Choose a front or side photo to upload.");
    if (!["image/jpeg", "image/png", "image/webp"].includes(contentType))
      return E(400, "Use a JPG, PNG or WEBP photo.");
    if (!Number.isSafeInteger(size) || size <= 0)
      return E(400, "Choose a valid photo.");
    if (size > 10 * 1024 * 1024)
      return E(413, "Photo is over 10 MB.");
    const extension = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" }[contentType];
    const path = `${u.id}/${crypto.randomUUID()}-${kind}.${extension}`;
    const { data, error } = await db.storage.from("photos").createSignedUploadUrl(path);
    if (error) return E(500, `Could not prepare photo upload: ${error.message}`);
    if (!data?.token) return E(500, "Could not prepare photo upload.");
    return J({ path, token: data.token });
  }
  const url = new URL(req.url);
  switch (`${method} ${a}${b ? "/" + b : ""}`) {
    case "GET me": {
      const { data: profile } = await db
        .from("profiles")
        .select("*")
        .eq("user_email", u.email)
        .maybeSingle();
      const { data: sub } = await db
        .from("subscriptions")
        .select("*")
        .eq("user_email", u.email)
        .maybeSingle();
      return J({
        id: u.id,
        email: u.email,
        profile,
        sub,
        paid: await isPaid(u.email),
        test: TEST(),
      });
    }
    case "POST profile": {
      if (!body.age_confirmed || !body.consent_accepted)
        return E(400, "Confirm age and consent to continue.");
      await db.from("profiles").upsert({
        user_email: u.email,
        gender: body.gender,
        age_range: body.age_range,
        main_goal: body.main_goal,
        age_confirmed: true,
        consent_at: new Date().toISOString(),
        onboarded: true,
      });
      return J({ ok: true });
    }
    case "POST settings": {
      const patch = {};
      for (const k of ["gender", "age_range", "main_goal", "keep_photos"])
        if (k in body) patch[k] = body[k];
      await db.from("profiles").update(patch).eq("user_email", u.email);
      return J({ ok: true });
    }
    case "POST analyze":
      return analyze(u, body);
    case "GET scan":
      return getScan(u, url.searchParams.get("id"));
    case "GET scans": {
      const { data } = await db
        .from("scans")
        .select("id,created_at,overall,tier,front_path")
        .eq("user_email", u.email)
        .order("created_at", { ascending: false });
      const list = await Promise.all(
        (data || []).map(async (s) => ({
          id: s.id,
          created_at: s.created_at,
          overall: s.overall,
          tier: s.tier,
          thumb: s.front_path
            ? (
                await db.storage
                  .from("photos")
                  .createSignedUrl(s.front_path, 3600)
              ).data?.signedUrl
            : null,
        })),
      );
      return J({ scans: list, paid: await isPaid(u.email) });
    }
    case "POST plan/toggle": {
      if (!(await isPaid(u.email))) return E(402, "paywall");
      await db
        .from("plan_items")
        .update({ completed: !!body.completed })
        .eq("id", body.id)
        .eq("user_email", u.email);
      return J({ ok: true });
    }
    case "GET chat": {
      if (!(await isPaid(u.email))) return J({ messages: [] });
      const { data } = await db
        .from("chat_messages")
        .select("role,content")
        .eq("user_email", u.email)
        .order("created_at")
        .limit(100);
      return J({ messages: data || [] });
    }
    case "POST coach":
      return coach(u, body);
    case "POST subscribe":
      return subscribe(u, body, req);
    case "POST cancel": {
      if (TEST()) {
        await db
          .from("subscriptions")
          .update({ status: "cancelled" })
          .eq("user_email", u.email);
        return J({ ok: true });
      }
      const { data: s } = await db
        .from("subscriptions")
        .select("stripe_subscription_id")
        .eq("user_email", u.email)
        .maybeSingle();
      if (s?.stripe_subscription_id)
        await new Stripe(process.env.STRIPE_SECRET_KEY).subscriptions.update(
          s.stripe_subscription_id,
          { cancel_at_period_end: true },
        );
      return J({ ok: true });
    }
    case "POST delete": {
      await wipePhotos(db, u.email);
      if (body.mode === "account") {
        for (const t of [
          "plan_items",
          "chat_messages",
          "scans",
          "subscriptions",
          "profiles",
        ])
          await db.from(t).delete().eq("user_email", u.email);
        if (!u.isTestUser) await db.auth.admin.deleteUser(u.id);
      }
      return J({ ok: true });
    }
  }
  return E(404, "Not found");
}
export const GET = (r, c) => handle(r, c, "GET");
export const POST = (r, c) => handle(r, c, "POST");
