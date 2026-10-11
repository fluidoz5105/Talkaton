const GOOGLE_IDENTITY_SCRIPT = "https://accounts.google.com/gsi/client";

let googleIdentityPromise = null;

export function loadGoogleIdentity() {
  if (globalThis.google?.accounts?.id) return Promise.resolve(globalThis.google.accounts.id);
  if (googleIdentityPromise) return googleIdentityPromise;

  googleIdentityPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${GOOGLE_IDENTITY_SCRIPT}"]`);
    const script = existing || document.createElement("script");
    const timeout = window.setTimeout(() => reject(new Error("Google sign-in took too long to load.")), 12_000);

    const finish = () => {
      window.clearTimeout(timeout);
      if (globalThis.google?.accounts?.id) resolve(globalThis.google.accounts.id);
      else reject(new Error("Google sign-in did not load correctly."));
    };

    script.addEventListener("load", finish, { once: true });
    script.addEventListener("error", () => {
      window.clearTimeout(timeout);
      googleIdentityPromise = null;
      reject(new Error("Google sign-in could not be loaded."));
    }, { once: true });

    if (!existing) {
      script.src = GOOGLE_IDENTITY_SCRIPT;
      script.async = true;
      script.defer = true;
      script.referrerPolicy = "strict-origin-when-cross-origin";
      document.head.append(script);
    }
  });

  return googleIdentityPromise;
}

export async function renderGoogleIdentityButton({
  container,
  clientId,
  mode = "signIn",
  onCredential,
  onError
}) {
  if (!container || !clientId) throw new Error("Google sign-in is not configured.");

  const googleIdentity = await loadGoogleIdentity();
  const nonce = createNonce();
  const hashedNonce = await sha256(nonce);
  const width = Math.max(220, Math.min(720, Math.floor(container.getBoundingClientRect().width || 520)));

  googleIdentity.initialize({
    client_id: clientId,
    nonce: hashedNonce,
    ux_mode: "popup",
    context: mode === "signUp" ? "signup" : "signin",
    use_fedcm_for_prompt: true,
    callback: async response => {
      try {
        if (!response?.credential) throw new Error("Google did not return a sign-in credential.");
        await onCredential({ token: response.credential, nonce });
      } catch (error) {
        onError?.(error);
      }
    }
  });

  container.replaceChildren();
  googleIdentity.renderButton(container, {
    type: "standard",
    theme: "outline",
    size: "large",
    shape: "rectangular",
    text: mode === "signUp" ? "signup_with" : "continue_with",
    logo_alignment: "left",
    width
  });
}

function createNonce() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes));
}

async function sha256(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}
