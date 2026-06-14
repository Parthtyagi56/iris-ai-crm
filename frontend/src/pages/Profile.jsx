import { useEffect, useRef, useState } from "react";
import {
  UserRound, LogOut, Pencil, Check, X, KeyRound, Camera, ShieldCheck,
} from "lucide-react";
import { api, API_URL, getToken, setSession, clearSession, fmtDate } from "../api.js";
import { usePageTitle } from "../App.jsx";
import { useToast } from "../components/Toast.jsx";
import { Skeleton } from "../components/Skeleton.jsx";

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const PHONE_RE = /^[+\d][\d\s\-()]{6,19}$/;
const ZIP_RE = /^[A-Za-z0-9 \-]{3,10}$/;
const GENDERS = ["", "Female", "Male", "Non-binary", "Prefer not to say"];

const EDITABLE = ["name", "username", "email", "phone", "date_of_birth",
                  "gender", "address", "city", "state", "country", "zip_code"];

function validateProfile(f) {
  const e = {};
  if (!f.name || f.name.trim().length < 2) e.name = "Name needs at least 2 characters.";
  if (!/^[a-zA-Z0-9_.\-]{3,60}$/.test(f.username || "")) e.username = "3–60 letters, digits, _ . -";
  if (!EMAIL_RE.test(f.email || "")) e.email = "Enter a valid email.";
  if (f.phone && !PHONE_RE.test(f.phone)) e.phone = "Enter a valid phone number.";
  if (f.date_of_birth) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(f.date_of_birth)) e.date_of_birth = "Use YYYY-MM-DD.";
    else if (f.date_of_birth > new Date().toISOString().slice(0, 10)) e.date_of_birth = "Can't be in the future.";
  }
  if (f.zip_code && !ZIP_RE.test(f.zip_code)) e.zip_code = "Enter a valid ZIP / postal code.";
  return e;
}

function Avatar({ user, src, size = 84 }) {
  const url = src || (user?.avatar_url ? API_URL + user.avatar_url : "");
  if (url) return <img className="avatar" src={url} alt="" width={size} height={size} />;
  const initials = (user?.name || "?").split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase();
  return <div className="avatar avatar-initials" style={{ width: size, height: size, fontSize: size / 3 }}>{initials}</div>;
}

function Field({ label, error, children }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {error && <span className="field-error">{error}</span>}
    </label>
  );
}

function SignIn({ onSignedIn }) {
  const toast = useToast();
  const [email, setEmail] = useState("admin@iris.shop");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await api.post("/api/auth/login", { email, password });
      setSession(res.token, res.user);
      toast(`Welcome back, ${res.user.name.split(" ")[0]}`, "success");
      onSignedIn(res.user);
    } catch (err) {
      toast(err.message, "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="panel signin-card" onSubmit={submit}>
      <h2><ShieldCheck size={16} /> Sign in to your workspace</h2>
      <Field label="Email">
        <input type="email" value={email} autoComplete="username"
               onChange={(e) => setEmail(e.target.value)} required />
      </Field>
      <Field label="Password">
        <input type="password" value={password} autoComplete="current-password"
               onChange={(e) => setPassword(e.target.value)} required />
      </Field>
      <button className="primary" disabled={busy} style={{ width: "100%" }}>
        {busy ? "Signing in…" : "Sign in"}
      </button>
      <p className="hint" style={{ marginBottom: 4 }}>
        Demo workspace: <code className="rules">admin@iris.shop</code> / <code className="rules">iris123</code>
      </p>
      <p className="hint" style={{ marginBottom: 0, fontSize: 11.5 }}>
        Best viewed in Chrome. On Brave, lower Shields (🦁) for this site if the
        app stalls on the loading screen.
      </p>
    </form>
  );
}

function PasswordCard({ onTokenRotated }) {
  const toast = useToast();
  const [form, setForm] = useState({ current_password: "", new_password: "", confirm_password: "" });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    if (form.new_password !== form.confirm_password) {
      return toast("New passwords don't match.", "error");
    }
    if (form.new_password.length < 8 || !/[a-zA-Z]/.test(form.new_password) || !/\d/.test(form.new_password)) {
      return toast("New password needs 8+ characters with a letter and a number.", "error");
    }
    setBusy(true);
    try {
      const res = await api.put("/api/profile/password", form);
      onTokenRotated(res.token);
      setForm({ current_password: "", new_password: "", confirm_password: "" });
      toast("Password updated.", "success");
    } catch (err) {
      toast(err.message, "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="panel" onSubmit={submit}>
      <h2><KeyRound size={15} /> Change password</h2>
      <div className="row">
        <Field label="Current password">
          <input type="password" value={form.current_password} autoComplete="current-password"
                 onChange={set("current_password")} required />
        </Field>
        <Field label="New password">
          <input type="password" value={form.new_password} autoComplete="new-password"
                 onChange={set("new_password")} required />
        </Field>
        <Field label="Confirm new password">
          <input type="password" value={form.confirm_password} autoComplete="new-password"
                 onChange={set("confirm_password")} required />
        </Field>
      </div>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
        <span className="hint">At least 8 characters with a letter and a number. Changing it signs out other sessions.</span>
        <button className="shrink" disabled={busy}>{busy ? "Updating…" : "Update password"}</button>
      </div>
    </form>
  );
}

export default function Profile() {
  usePageTitle("My profile");
  const toast = useToast();
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(!!getToken());
  const [authed, setAuthed] = useState(!!getToken());

  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(null);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);

  const fileRef = useRef(null);
  const [avatarPreview, setAvatarPreview] = useState("");
  const [avatarFile, setAvatarFile] = useState(null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);

  useEffect(() => {
    if (!getToken()) return;
    api.get("/api/profile")
      .then((u) => { setUser(u); setSession(getToken(), u); })
      .catch((e) => {
        clearSession();
        setAuthed(false);
        toast(e.message, "error");
      })
      .finally(() => setLoading(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const startEdit = () => {
    setForm(Object.fromEntries(EDITABLE.map((k) => [k, user[k] ?? ""])));
    setErrors({});
    setEditing(true);
  };

  const save = async () => {
    const errs = validateProfile(form);
    setErrors(errs);
    if (Object.keys(errs).length) {
      return toast("Fix the highlighted fields first.", "error");
    }
    setSaving(true);
    try {
      const updated = await api.put("/api/profile", form);
      setUser(updated);
      setSession(getToken(), updated);
      setEditing(false);
      toast("Profile updated.", "success");
    } catch (e) {
      toast(e.message, "error");
    } finally {
      setSaving(false);
    }
  };

  const pickAvatar = (e) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    if (!["image/png", "image/jpeg", "image/webp"].includes(f.type)) {
      return toast("Use a PNG, JPEG or WebP image.", "error");
    }
    if (f.size > 2 * 1024 * 1024) return toast("Image must be 2 MB or smaller.", "error");
    setAvatarFile(f);
    setAvatarPreview(URL.createObjectURL(f));
  };

  const saveAvatar = async () => {
    setUploadingAvatar(true);
    try {
      const fd = new FormData();
      fd.append("file", avatarFile);
      const updated = await api.postForm("/api/profile/avatar", fd);
      setUser(updated);
      setSession(getToken(), updated);
      setAvatarFile(null);
      setAvatarPreview("");
      toast("Profile photo updated.", "success");
    } catch (e) {
      toast(e.message, "error");
    } finally {
      setUploadingAvatar(false);
    }
  };

  const signOut = async () => {
    try { await api.post("/api/auth/logout", {}); } catch { /* token may be stale */ }
    clearSession();
    setUser(null);
    setAuthed(false);
    toast("Signed out.", "info");
  };

  const view = (k) => user?.[k] || <span className="muted">—</span>;
  const input = (k, type = "text") => (
    <Field key={k} label={k.replaceAll("_", " ").replace(/^./, (c) => c.toUpperCase())} error={errors[k]}>
      {k === "gender" ? (
        <select value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })}>
          {GENDERS.map((g) => <option key={g} value={g}>{g || "—"}</option>)}
        </select>
      ) : (
        <input type={type} value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} />
      )}
    </Field>
  );

  if (!authed) {
    return (
      <>
        <div className="page-head">
          <div><h1>My profile</h1><p>Sign in to view and manage your workspace profile.</p></div>
        </div>
        <SignIn onSignedIn={(u) => { setUser(u); setAuthed(true); setLoading(false); }} />
      </>
    );
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>My profile</h1>
          <p>Your workspace identity — shown on campaigns and audit trails.</p>
        </div>
        {user && !editing && (
          <button onClick={startEdit}><Pencil size={14} /> Edit profile</button>
        )}
        {editing && (
          <div style={{ display: "flex", gap: 8 }}>
            <button className="ghost" disabled={saving} onClick={() => setEditing(false)}><X size={14} /> Cancel</button>
            <button className="primary" disabled={saving} onClick={save}>
              <Check size={14} /> {saving ? "Saving…" : "Save changes"}
            </button>
          </div>
        )}
      </div>

      {loading || !user ? (
        <div className="panel" style={{ marginTop: 0 }}>
          <Skeleton w={84} h={84} style={{ borderRadius: "50%", display: "block", marginBottom: 12 }} />
          <Skeleton w="40%" h={18} style={{ marginBottom: 8, display: "block" }} />
          <Skeleton w="60%" h={12} style={{ display: "block" }} />
        </div>
      ) : (
        <div className="profile-grid">
          <div className="panel profile-card" style={{ marginTop: 0 }}>
            <div className="avatar-wrap">
              <Avatar user={user} src={avatarPreview} />
              <button className="avatar-edit" aria-label="Change profile photo"
                      onClick={() => fileRef.current?.click()}>
                <Camera size={13} />
              </button>
              <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp"
                     style={{ display: "none" }} onChange={pickAvatar} aria-label="Profile image file" />
            </div>
            {avatarFile && (
              <div className="avatar-actions">
                <button className="ghost" onClick={() => { setAvatarFile(null); setAvatarPreview(""); }}>Discard</button>
                <button className="primary" disabled={uploadingAvatar} onClick={saveAvatar}>
                  {uploadingAvatar ? "Uploading…" : "Save photo"}
                </button>
              </div>
            )}
            <h2 style={{ margin: "10px 0 2px" }}>{user.name}</h2>
            <div className="muted">@{user.username}</div>
            <div style={{ display: "flex", gap: 6, margin: "10px 0" }}>
              <span className="badge ai">{user.role}</span>
              <span className={`badge ${user.status === "active" ? "converted" : "failed"}`}>{user.status}</span>
            </div>
            <div className="profile-meta">
              <span>Member since</span><strong>{fmtDate(user.created_at)}</strong>
              <span>Last updated</span><strong>{fmtDate(user.updated_at)}</strong>
            </div>
            <button className="ghost" style={{ marginTop: 14 }} onClick={signOut}>
              <LogOut size={14} /> Sign out
            </button>
          </div>

          <div>
            <div className="panel" style={{ marginTop: 0 }}>
              <h2><UserRound size={15} /> Personal information</h2>
              {editing ? (
                <div className="kv-grid">
                  {input("name")}{input("username")}{input("date_of_birth", "date")}{input("gender")}
                </div>
              ) : (
                <dl className="kv">
                  <dt>Full name</dt><dd>{view("name")}</dd>
                  <dt>Username</dt><dd>@{user.username}</dd>
                  <dt>Date of birth</dt><dd>{view("date_of_birth")}</dd>
                  <dt>Gender</dt><dd>{view("gender")}</dd>
                  <dt>Role</dt><dd>{user.role} <span className="hint">(read-only)</span></dd>
                </dl>
              )}
            </div>

            <div className="panel">
              <h2><ShieldCheck size={15} /> Contact information</h2>
              {editing ? (
                <div className="kv-grid">
                  {input("email", "email")}{input("phone")}{input("address")}{input("city")}
                  {input("state")}{input("country")}{input("zip_code")}
                </div>
              ) : (
                <dl className="kv">
                  <dt>Email</dt><dd>{view("email")}</dd>
                  <dt>Phone</dt><dd>{view("phone")}</dd>
                  <dt>Address</dt><dd>{view("address")}</dd>
                  <dt>City</dt><dd>{view("city")}</dd>
                  <dt>State</dt><dd>{view("state")}</dd>
                  <dt>Country</dt><dd>{view("country")}</dd>
                  <dt>ZIP code</dt><dd>{view("zip_code")}</dd>
                </dl>
              )}
            </div>

            <PasswordCard onTokenRotated={(t) => setSession(t, user)} />
          </div>
        </div>
      )}
    </>
  );
}
