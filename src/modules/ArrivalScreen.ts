/**
 * ArrivalScreen — terminal arrival state UI with restart option.
 * Requirements: 1.3
 */
export class ArrivalScreen {
  private _overlay: HTMLElement | null = null;
  private readonly _container: HTMLElement;
  private _visible: boolean = false;
  private _onRestart: (() => void) | null = null;

  constructor(container: HTMLElement = document.body) {
    this._container = container;
  }

  /**
   * Display the arrival overlay.
   * @param onRestart - Called when the user clicks "Ride again".
   */
  show(onRestart?: () => void): void {
    this._onRestart = onRestart ?? null;
    if (!this._overlay) {
      this._overlay = this._createElement();
      this._container.appendChild(this._overlay);
    }
    this._overlay.style.display = "flex";
    this._overlay.removeAttribute("aria-hidden");
    this._visible = true;
  }

  hide(): void {
    if (!this._overlay) return;
    this._overlay.style.display = "none";
    this._overlay.setAttribute("aria-hidden", "true");
    this._visible = false;
  }

  get isVisible(): boolean {
    return this._visible;
  }

  private _createElement(): HTMLElement {
    const overlay = document.createElement("div");
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-labelledby", "arrival-title");
    overlay.setAttribute("tabindex", "0");

    Object.assign(overlay.style, {
      position: "fixed",
      inset: "0",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: "rgba(0, 0, 0, 0.72)",
      zIndex: "9999",
      pointerEvents: "all",
      opacity: "1",
      fontFamily: "'Georgia', 'Times New Roman', serif",
    } satisfies Partial<CSSStyleDeclaration>);

    const content = document.createElement("div");
    Object.assign(content.style, {
      textAlign: "center",
      color: "#f5f0e8",
      padding: "3rem 4rem",
      maxWidth: "480px",
      backgroundColor: "rgba(20, 18, 14, 0.85)",
      borderRadius: "4px",
      border: "1px solid rgba(245, 240, 232, 0.15)",
    } satisfies Partial<CSSStyleDeclaration>);

    const title = document.createElement("h1");
    title.id = "arrival-title";
    title.textContent = "You've arrived";
    Object.assign(title.style, {
      margin: "0 0 1rem",
      fontSize: "2rem",
      fontWeight: "normal",
      letterSpacing: "0.04em",
      lineHeight: "1.2",
    } satisfies Partial<CSSStyleDeclaration>);

    const message = document.createElement("p");
    message.textContent = "The journey is complete.";
    Object.assign(message.style, {
      margin: "0 0 2rem",
      fontSize: "1rem",
      lineHeight: "1.6",
      opacity: "0.8",
    } satisfies Partial<CSSStyleDeclaration>);

    // ── Restart button ───────────────────────────────────────────────────
    const restartBtn = document.createElement("button");
    restartBtn.textContent = "Ride again";
    restartBtn.type = "button";
    Object.assign(restartBtn.style, {
      display: "inline-block",
      padding: "0.75rem 2rem",
      border: "1px solid rgba(245, 240, 232, 0.5)",
      borderRadius: "3px",
      background: "transparent",
      color: "#f5f0e8",
      fontFamily: "inherit",
      fontSize: "0.95rem",
      letterSpacing: "0.05em",
      cursor: "pointer",
    } satisfies Partial<CSSStyleDeclaration>);

    restartBtn.addEventListener("mouseover", () => {
      restartBtn.style.background = "rgba(245, 240, 232, 0.12)";
    });
    restartBtn.addEventListener("mouseout", () => {
      restartBtn.style.background = "transparent";
    });

    restartBtn.addEventListener("click", () => {
      this.hide();
      this._onRestart?.();
    });

    content.appendChild(title);
    content.appendChild(message);
    content.appendChild(restartBtn);
    overlay.appendChild(content);

    return overlay;
  }
}
