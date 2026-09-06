const api = window.missionControlAuth;
const touchButton = document.querySelector("#touch-id");
const pinForm = document.querySelector("#pin-form");
const pinInput = document.querySelector("#pin");
const message = document.querySelector("#message");
const accountButton = document.querySelector("#account-login");
const separator = document.querySelector("#separator");
let busy = false;

const messages = {
  TOUCH_ID_UNAVAILABLE: "Touch ID is not available on this Mac.",
  TOUCH_ID_CANCELLED: "Touch ID was cancelled. Try again or use your PIN.",
  PIN_INVALID: "That PIN is incorrect.",
  PIN_LOCKED: "Too many attempts. Try again shortly.",
  DESKTOP_ACCOUNT_CREDENTIALS_MISSING: "Desktop sign-in is not configured for this Mission Control account.",
  DESKTOP_ACCOUNT_LOGIN_FAILED: "The saved Mission Control account credentials need to be updated.",
  DESKTOP_ACCOUNT_LOGIN_UNAVAILABLE: "Mission Control could not complete sign-in. Try again.",
  DESKTOP_SESSION_VERIFY_FAILED: "Mission Control could not verify the new session. Try again.",
  DESKTOP_AUTH_FAILED: "Desktop sign-in failed. Try again or use account login.",
};

function setBusy(value) {
  busy = value;
  touchButton.disabled = value;
  pinInput.disabled = value;
  pinForm.querySelector("button").disabled = value;
}

async function unlock(method, pin = "") {
  if (busy) return;
  setBusy(true);
  message.textContent = method === "touch-id" ? "Waiting for Touch ID…" : "Signing in…";
  try {
    const result = await api.unlock(method, pin);
    if (!result.ok) {
      message.textContent = messages[result.code] || "Sign-in failed. Try again.";
      if (result.retryAfter) {
        const seconds = Math.max(1, Math.ceil(result.retryAfter / 1000));
        message.textContent += ` Available in ${seconds} seconds.`;
      }
    }
  } catch { message.textContent = messages.DESKTOP_AUTH_FAILED; }
  finally { pinInput.value = ""; setBusy(false); }
}

touchButton.addEventListener("click", () => unlock("touch-id"));
pinForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (/^\d{4}$/.test(pinInput.value)) unlock("pin", pinInput.value);
  else message.textContent = "Enter your four-digit PIN.";
});
pinInput.addEventListener("input", () => {
  pinInput.value = pinInput.value.replace(/\D/g, "").slice(0, 4);
});
accountButton.addEventListener("click", () => api.dismiss());

api.status().then((status) => {
  touchButton.hidden = !status.touchId;
  pinForm.hidden = !status.pin;
  separator.hidden = !status.touchId || !status.pin;
  if (!status.touchId && !status.pin) message.textContent = "Desktop sign-in has not been configured.";
  else if (!status.touchId) pinInput.focus();
}).catch(() => { message.textContent = "Desktop sign-in is unavailable."; });
