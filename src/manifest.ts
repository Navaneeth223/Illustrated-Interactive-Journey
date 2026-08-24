import type { JourneyManifest } from "@/types/journey";

const RETRY_DELAY_MS = 500;

/**
 * Renders a full-viewport blocking overlay when the manifest cannot be loaded.
 * Provides a "Retry" button that reloads the page.
 */
export function showManifestError(): void {
  // Remove any existing error overlay to avoid duplicates
  const existing = document.getElementById("manifest-error-overlay");
  if (existing) {
    existing.remove();
  }

  const overlay = document.createElement("div");
  overlay.id = "manifest-error-overlay";

  Object.assign(overlay.style, {
    position: "fixed",
    inset: "0",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    background: "rgba(10, 10, 10, 0.92)",
    color: "#f0f0f0",
    fontFamily: "system-ui, sans-serif",
    zIndex: "9999",
    gap: "1.5rem",
    padding: "2rem",
    boxSizing: "border-box",
  });

  const heading = document.createElement("h1");
  heading.textContent = "Unable to load journey";
  Object.assign(heading.style, {
    margin: "0",
    fontSize: "1.5rem",
    fontWeight: "600",
    textAlign: "center",
  });

  const message = document.createElement("p");
  message.textContent =
    "The journey data could not be fetched. Please check your connection and try again.";
  Object.assign(message.style, {
    margin: "0",
    fontSize: "1rem",
    textAlign: "center",
    maxWidth: "480px",
    lineHeight: "1.6",
    opacity: "0.8",
  });

  const retryButton = document.createElement("button");
  retryButton.textContent = "Retry";
  retryButton.type = "button";
  Object.assign(retryButton.style, {
    padding: "0.75rem 2rem",
    fontSize: "1rem",
    fontWeight: "600",
    cursor: "pointer",
    background: "#f0f0f0",
    color: "#0a0a0a",
    border: "none",
    borderRadius: "4px",
  });
  retryButton.addEventListener("click", () => {
    window.location.reload();
  });

  overlay.appendChild(heading);
  overlay.appendChild(message);
  overlay.appendChild(retryButton);
  document.body.appendChild(overlay);
}

/**
 * Fetches and parses the journey manifest from the given URL.
 *
 * - Retries once after {@link RETRY_DELAY_MS} on any network error or non-OK HTTP status.
 * - On second failure, calls {@link showManifestError} to render a blocking overlay
 *   and then throws the error so callers can handle or log it.
 */
export async function loadManifest(url: string): Promise<JourneyManifest> {
  async function attempt(): Promise<Response> {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(
        `Manifest fetch failed: ${response.status} ${response.statusText}`
      );
    }
    return response;
  }

  async function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  let response: Response;

  try {
    response = await attempt();
  } catch (_firstError) {
    // Wait before retrying
    await delay(RETRY_DELAY_MS);

    try {
      response = await attempt();
    } catch (secondError) {
      showManifestError();
      throw secondError instanceof Error
        ? secondError
        : new Error("Manifest fetch failed after retry");
    }
  }

  const manifest = (await response.json()) as JourneyManifest;
  return manifest;
}
