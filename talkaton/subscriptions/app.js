import { createSharedAuthStorage } from "../modules/shared-auth-storage.js?v=20260813-shared-session1";

const CONFIG = Object.freeze({
  SUPABASE_URL: "https://cxulgeojkjnskdyoktkj.supabase.co",
  SUPABASE_KEY: "sb_publishable_GgxtfIaIamzZFY_jMU4_Cw_V8NKm475",
  BILLING_ORIGIN: "https://subscriptions.talkaton.org"
});

if (location.hostname === "subscriptions.talkaton.org" && location.pathname.startsWith("/subscriptions")) {
  history.replaceState(history.state, "", `/${location.search}${location.hash}`);
}

const PLAN_LABELS = Object.freeze({
  guest: "Guest",
  free: "Talkaton Free",
  plus: "Talkaton Plus",
  pro: "Talkaton Pro",
  max: "Talkaton Max",
  beta: "Trusted Beta",
  dev: "Developer",
  support: "Support",
  owner: "Owner"
});

const DOM = Object.fromEntries([
  "accountPlan", "accountDetail", "accountActionBtn", "manageTopBtn", "signInCallout",
  "authLaunchBtn", "authDialog", "authCloseBtn", "authSignInTab", "authSignUpTab", "authTitle",
  "authDescription", "signInForm", "emailInput", "passwordInput", "confirmPasswordLabel",
  "confirmPasswordInput", "authSubmitBtn", "authGoogleBtn", "authProviderSection",
  "magicLinkBtn", "forgotPasswordBtn", "formMessage",
  "authMessage", "signedInBox", "signedInEmail", "signOutBtn", "toast"
].map(id => [id, document.getElementById(id)]));

let session = null;
let authMode = "signIn";
let billing = emptyBilling();
let pendingPlan = "";
let googleAuthEnabled = false;

const createClient = globalThis.supabase?.createClient;
const supabase = typeof createClient === "function"
  ? createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_KEY, {
      auth: {
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: true,
        flowType: "pkce",
        storage: createSharedAuthStorage()
      }
    })
  : null;

bindEvents();
initialize();

function bindEvents() {
  DOM.authLaunchBtn.addEventListener("click", () => openAuth("signIn"));
  DOM.authCloseBtn.addEventListener("click", closeAuth);
  DOM.authGoogleBtn.addEventListener("click", startSubscriptionGoogleRedirect);
  DOM.authDialog.addEventListener("close", resetClosedAuthDialog);
  DOM.authDialog.addEventListener("click", event => {
    if (event.target === DOM.authDialog) closeAuth();
  });
  DOM.authSignInTab.addEventListener("click", () => setAuthMode("signIn"));
  DOM.authSignUpTab.addEventListener("click", () => setAuthMode("signUp"));
  DOM.signInForm.addEventListener("submit", submitPasswordAuth);
  DOM.magicLinkBtn.addEventListener("click", sendMagicLink);
  DOM.forgotPasswordBtn.addEventListener("click", sendPasswordReset);
  DOM.signOutBtn.addEventListener("click", signOut);
  DOM.accountActionBtn.addEventListener("click", handleAccountAction);
  DOM.manageTopBtn.addEventListener("click", openBillingPortal);
  document.querySelectorAll("[data-plan]").forEach(button => {
    button.addEventListener("click", () => choosePlan(button.dataset.plan, button));
  });
}

async function initialize() {
  if (!supabase) {
    setPageMessage("Account services did not load. Refresh and try again.");
    disablePlanButtons();
    return;
  }

  await refreshAuthProviderAvailability();
  const { data, error } = await supabase.auth.getSession();
  if (error) setPageMessage("Your subscription session could not be restored.");
  session = isConfirmedSession(data?.session) ? data.session : null;
  if (data?.session && !session) await supabase.auth.signOut({ scope: "local" });

  const billingReturn = getBillingReturn();
  await refreshBilling({ force: Boolean(billingReturn) });
  if (billingReturn === "success" && session && !billing.paid) {
    await waitForPaidActivation();
  }
  syncPage();
  showBillingReturn(billingReturn);
  handleAuthRequest();

  supabase.auth.onAuthStateChange(async (event, nextSession) => {
    if (!["INITIAL_SESSION", "SIGNED_IN", "SIGNED_OUT", "TOKEN_REFRESHED", "USER_UPDATED"].includes(event)) return;
    if (nextSession && !isConfirmedSession(nextSession)) {
      session = null;
      setAuthMessage("Confirm your email before signing in.");
      return;
    }
    session = nextSession || null;
    await refreshBilling({ force: event === "SIGNED_IN" });
    syncPage();
    if (event === "SIGNED_IN") {
      closeAuth();
      showToast("Signed in. You can choose a plan now.");
      if (pendingPlan) {
        const button = document.querySelector(`[data-plan="${CSS.escape(pendingPlan)}"]`);
        const plan = pendingPlan;
        pendingPlan = "";
        choosePlan(plan, button);
      }
    }
  });
}

async function refreshAuthProviderAvailability() {
  try {
    const response = await fetch(`${CONFIG.SUPABASE_URL}/auth/v1/settings`, {
      headers: { apikey: CONFIG.SUPABASE_KEY },
      cache: "no-store",
      credentials: "omit"
    });
    if (!response.ok) throw new Error("Google sign-in settings are unavailable.");
    const settings = await response.json();
    googleAuthEnabled = settings?.external?.google === true;
  } catch {
    googleAuthEnabled = false;
  }
  DOM.authProviderSection.hidden = !googleAuthEnabled;
  DOM.authGoogleBtn.disabled = !googleAuthEnabled;
}

async function startSubscriptionGoogleRedirect() {
  setAuthMessage("");
  DOM.authGoogleBtn.setAttribute("aria-busy", "true");
  DOM.authGoogleBtn.disabled = true;
  try {
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${CONFIG.BILLING_ORIGIN}/`,
        skipBrowserRedirect: true
      }
    });
    if (error) throw error;
    if (!data?.url) throw new Error("Google sign-in did not return a secure redirect.");
    window.location.assign(data.url);
  } catch (error) {
    setAuthMessage(friendlyAuthError(error));
    DOM.authGoogleBtn.setAttribute("aria-busy", "false");
    DOM.authGoogleBtn.disabled = false;
  }
}

function emptyBilling() {
  return {
    authenticated: false,
    plan: "guest",
    paid: false,
    billingConfigured: false,
    testMode: false
  };
}

function isConfirmedSession(value) {
  return Boolean(value?.user?.email && value.user.email_confirmed_at);
}

async function refreshBilling({ force = false } = {}) {
  try {
    const response = await fetch(`/api/billing-status${force ? "?refresh=1" : ""}`, {
      headers: getAuthHeaders(),
      cache: "no-store"
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || "Billing status is unavailable.");
    billing = result;
  } catch (error) {
    billing = { ...emptyBilling(), authenticated: Boolean(session), plan: session ? "free" : "guest" };
    setPageMessage(error.message || "Billing status is temporarily unavailable.");
  }
}

function syncPage() {
  const plan = billing.plan || (session ? "free" : "guest");
  const signedIn = Boolean(session?.user);
  const unlimited = billing.unlimited === true;
  DOM.accountPlan.textContent = PLAN_LABELS[plan] || "Talkaton Free";
  DOM.accountDetail.textContent = signedIn
    ? `${session.user.email}${billing.testMode ? " · Stripe test mode" : ""}`
    : "Sign in here before choosing a subscription.";
  DOM.accountActionBtn.textContent = billing.paid ? "Manage subscription" : signedIn ? "Choose a plan" : "Sign in to subscribe";
  DOM.manageTopBtn.hidden = !billing.paid;
  DOM.signInCallout.hidden = signedIn;
  DOM.signedInBox.hidden = !signedIn;
  DOM.signedInEmail.textContent = session?.user?.email || "";

  document.querySelectorAll("[data-plan]").forEach(button => {
    const selectedPlan = button.dataset.plan;
    const isCurrent = plan === selectedPlan;
    button.closest("[data-plan-card]")?.classList.toggle("current", isCurrent);
    button.disabled = isCurrent || unlimited || !billing.billingConfigured;
    button.textContent = isCurrent
      ? "Current plan"
      : unlimited
        ? "Included with your access"
        : billing.paid
          ? `Manage ${capitalize(selectedPlan)}`
          : billing.billingConfigured
            ? signedIn ? `Choose ${capitalize(selectedPlan)}` : `Sign in for ${capitalize(selectedPlan)}`
            : "Checkout unavailable";
  });
}

function openAuth(mode = "signIn") {
  setAuthMode(mode);
  setAuthMessage("");
  if (!DOM.authDialog.open) DOM.authDialog.showModal();
  requestAnimationFrame(() => {
    DOM.emailInput.focus();
  });
}

function closeAuth() {
  if (DOM.authDialog.open) DOM.authDialog.close();
}

function resetClosedAuthDialog() {
  DOM.authGoogleBtn.setAttribute("aria-busy", "false");
  DOM.authGoogleBtn.disabled = !googleAuthEnabled;
  setAuthMessage("");
}

function setAuthMode(mode) {
  authMode = mode === "signUp" ? "signUp" : "signIn";
  const signUp = authMode === "signUp";
  DOM.authSignInTab.setAttribute("aria-selected", String(!signUp));
  DOM.authSignUpTab.setAttribute("aria-selected", String(signUp));
  DOM.authTitle.textContent = signUp ? "Create your account" : "Welcome back";
  DOM.authDescription.textContent = signUp
    ? "Create a subscription account, then confirm your email."
    : "Sign in to choose or manage a plan.";
  DOM.confirmPasswordLabel.hidden = !signUp;
  DOM.confirmPasswordInput.hidden = !signUp;
  DOM.confirmPasswordInput.disabled = !signUp;
  DOM.confirmPasswordInput.required = signUp;
  DOM.passwordInput.autocomplete = signUp ? "new-password" : "current-password";
  DOM.authSubmitBtn.textContent = signUp ? "Create account" : "Continue";
  DOM.magicLinkBtn.textContent = signUp ? "Create account with an email link" : "Email me a one-time sign-in link";
  DOM.forgotPasswordBtn.hidden = signUp;
  setAuthMessage("");
  DOM.authGoogleBtn.disabled = !googleAuthEnabled;
}

async function submitPasswordAuth(event) {
  event.preventDefault();
  const email = DOM.emailInput.value.trim();
  const password = DOM.passwordInput.value;
  const signUp = authMode === "signUp";
  if (!email || !DOM.emailInput.checkValidity()) {
    setAuthMessage("Enter a valid email address.");
    DOM.emailInput.reportValidity();
    return;
  }
  if (password.length < 8) {
    setAuthMessage("Your password must have at least 8 characters.");
    DOM.passwordInput.focus();
    return;
  }
  if (signUp && password !== DOM.confirmPasswordInput.value) {
    setAuthMessage("Those passwords do not match.");
    DOM.confirmPasswordInput.focus();
    return;
  }

  setAuthBusy(true, signUp ? "Creating account…" : "Signing in…");
  setAuthMessage("");
  try {
    if (signUp) {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: `${CONFIG.BILLING_ORIGIN}/?auth=confirmed` }
      });
      if (error) throw error;
      if (isConfirmedSession(data?.session)) {
        session = data.session;
        await refreshBilling({ force: true });
        syncPage();
        closeAuth();
      } else {
        setAuthMessage("Account created. Open the confirmation email before signing in.", true);
      }
      return;
    }

    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    if (!isConfirmedSession(data?.session)) {
      await supabase.auth.signOut({ scope: "local" });
      throw new Error("Confirm your email before signing in.");
    }
    session = data.session;
    await refreshBilling({ force: true });
    syncPage();
    closeAuth();
    showToast("Signed in securely.");
  } catch (error) {
    setAuthMessage(friendlyAuthError(error));
  } finally {
    setAuthBusy(false);
  }
}

async function sendMagicLink() {
  const email = DOM.emailInput.value.trim();
  if (!email || !DOM.emailInput.checkValidity()) {
    setAuthMessage("Enter your email address first.");
    DOM.emailInput.reportValidity();
    return;
  }
  setAuthBusy(true, "Sending secure link…");
  try {
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        shouldCreateUser: authMode === "signUp",
        emailRedirectTo: `${CONFIG.BILLING_ORIGIN}/?auth=confirmed`
      }
    });
    if (error) throw error;
    setAuthMessage(authMode === "signUp"
      ? "Confirmation link sent. Open it to create your account."
      : "Secure sign-in link sent. Open it in this browser.", true);
  } catch (error) {
    setAuthMessage(friendlyAuthError(error));
  } finally {
    setAuthBusy(false);
  }
}

async function sendPasswordReset() {
  const email = DOM.emailInput.value.trim();
  if (!email || !DOM.emailInput.checkValidity()) {
    setAuthMessage("Enter your account email first.");
    DOM.emailInput.reportValidity();
    return;
  }
  setAuthBusy(true, "Sending reset link…");
  try {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${CONFIG.BILLING_ORIGIN}/?auth=recovery`
    });
    if (error) throw error;
    setAuthMessage("Password reset link sent. Check your inbox and spam folder.", true);
  } catch (error) {
    setAuthMessage(friendlyAuthError(error));
  } finally {
    setAuthBusy(false);
  }
}

function setAuthBusy(busy, label = "") {
  DOM.authSubmitBtn.disabled = busy;
  DOM.magicLinkBtn.disabled = busy;
  DOM.forgotPasswordBtn.disabled = busy;
  DOM.authSignInTab.disabled = busy;
  DOM.authSignUpTab.disabled = busy;
  DOM.authGoogleBtn.setAttribute("aria-busy", String(busy));
  if (label) DOM.authSubmitBtn.textContent = label;
  if (!busy) DOM.authSubmitBtn.textContent = authMode === "signUp" ? "Create account" : "Continue";
}

async function choosePlan(plan, button) {
  if (!session?.user || !isConfirmedSession(session)) {
    pendingPlan = plan;
    openAuth("signIn");
    setAuthMessage(`Sign in with a confirmed account to choose Talkaton ${capitalize(plan)}.`);
    return;
  }
  if (billing.paid) {
    await openBillingPortal();
    return;
  }

  const original = button?.textContent || "Choose plan";
  if (button) {
    button.disabled = true;
    button.textContent = "Opening secure checkout…";
  }
  try {
    const response = await fetch("/api/billing-checkout", {
      method: "POST",
      headers: getAuthHeaders({ json: true }),
      body: JSON.stringify({ plan })
    });
    const result = await response.json().catch(() => ({}));
    if (response.status === 401 || response.status === 403) {
      session = null;
      syncPage();
      openAuth("signIn");
    }
    if (!response.ok || !result?.url) throw new Error(result.error || "Checkout could not start.");
    window.location.assign(result.url);
  } catch (error) {
    showToast(error.message || "Checkout could not start.");
    if (button) {
      button.disabled = false;
      button.textContent = original;
    }
  }
}

async function openBillingPortal() {
  if (!session?.user || !isConfirmedSession(session)) {
    openAuth("signIn");
    return;
  }
  DOM.manageTopBtn.disabled = true;
  try {
    const response = await fetch("/api/billing-portal", {
      method: "POST",
      headers: getAuthHeaders({ json: true }),
      body: "{}"
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result?.url) throw new Error(result.error || "Subscription management could not open.");
    window.location.assign(result.url);
  } catch (error) {
    showToast(error.message || "Subscription management could not open.");
    DOM.manageTopBtn.disabled = false;
  }
}

function handleAccountAction() {
  if (billing.paid) openBillingPortal();
  else if (session?.user) document.getElementById("plans").scrollIntoView({ behavior: "smooth" });
  else openAuth("signIn");
}

async function signOut() {
  if (!supabase) return;
  await supabase.auth.signOut({ scope: "local" });
  session = null;
  billing = emptyBilling();
  await refreshBilling();
  syncPage();
  showToast("Signed out of subscriptions.");
}

function getAuthHeaders({ json = false } = {}) {
  const headers = {};
  if (json) headers["Content-Type"] = "application/json";
  if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`;
  return headers;
}

function hasBillingReturn() {
  return new URL(location.href).searchParams.has("billing");
}

function getBillingReturn() {
  return new URL(location.href).searchParams.get("billing") || "";
}

async function waitForPaidActivation() {
  for (let attempt = 0; attempt < 5 && !billing.paid; attempt += 1) {
    await new Promise(resolve => setTimeout(resolve, 900 + attempt * 300));
    await refreshBilling({ force: true });
  }
}

function showBillingReturn(result = getBillingReturn()) {
  const url = new URL(location.href);
  if (!result) return;
  url.searchParams.delete("billing");
  url.searchParams.delete("session_id");
  history.replaceState({}, document.title, `${url.pathname}${url.search}${url.hash}`);
  if (result === "success") {
    showToast(billing.paid
      ? `${PLAN_LABELS[billing.plan] || "Your plan"} is active.`
      : "Payment received. Stripe is still finishing activation; refresh shortly.");
  }
  if (result === "cancelled") showToast("Checkout canceled. Your plan did not change.");
  if (result === "returned") showToast("Your subscription details are up to date.");
}

function handleAuthRequest() {
  const url = new URL(location.href);
  const mode = url.searchParams.get("signup") === "1" ? "signUp" : "signIn";
  const shouldOpen = url.searchParams.has("signup") || url.searchParams.has("auth");
  if (!shouldOpen) return;
  url.searchParams.delete("signup");
  url.searchParams.delete("auth");
  history.replaceState({}, document.title, `${url.pathname}${url.search}${url.hash}`);
  if (!session) openAuth(mode);
}

function disablePlanButtons() {
  document.querySelectorAll("[data-plan]").forEach(button => { button.disabled = true; });
}

function setPageMessage(message, success = false) {
  DOM.formMessage.textContent = message;
  DOM.formMessage.classList.toggle("success", success);
}

function setAuthMessage(message, success = false) {
  DOM.authMessage.textContent = message;
  DOM.authMessage.classList.toggle("success", success);
}

function friendlyAuthError(error) {
  const message = String(error?.message || "Account request failed.");
  if (/invalid login credentials/i.test(message)) return "Email or password is incorrect.";
  if (/email not confirmed/i.test(message)) return "Confirm your email before signing in.";
  if (/user already registered/i.test(message)) return "An account already exists. Choose Sign in.";
  if (/rate limit|too many/i.test(message)) return "Too many attempts. Wait a few minutes and try again.";
  return message;
}

function showToast(message) {
  DOM.toast.textContent = message;
  DOM.toast.hidden = false;
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => { DOM.toast.hidden = true; }, 5200);
}

function capitalize(value) {
  const text = String(value || "");
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
}
