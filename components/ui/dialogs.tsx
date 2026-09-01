"use client";

// Sistema de diálogos propio del producto, en reemplazo de window.confirm /
// alert / prompt del navegador.
//
// Por qué: los diálogos nativos rompen la identidad visual (cada navegador los
// pinta a su manera y muestran el dominio de Vercel), no permiten jerarquía de
// riesgo ni pedir la clave del administrador antes de una acción destructiva.
//
// API basada en promesas para que el código que llama se lea igual que antes:
//
//   const ok = await dialog.confirm({ title: "…", message: "…" });
//   const nota = await dialog.prompt({ title: "…", label: "Motivo" });
//   const clave = await dialog.confirmWithPassword({ title: "…" });

import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";

type Tone = "default" | "danger";

type ConfirmSpec = {
  title: string;
  message?: string;
  /** Aviso destacado (consecuencias irreversibles, por ejemplo). */
  warning?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: Tone;
};

type PromptSpec = ConfirmSpec & {
  label?: string;
  placeholder?: string;
  defaultValue?: string;
  /** Si es true, no deja confirmar con el campo vacío. */
  required?: boolean;
  multiline?: boolean;
};

type PasswordSpec = ConfirmSpec & {
  /** Texto sobre el campo de clave. */
  label?: string;
};

type Kind = "confirm" | "prompt" | "password";

type State =
  | null
  | (PromptSpec &
      PasswordSpec & {
        kind: Kind;
        resolve: (v: never) => void;
      });

type DialogApi = {
  confirm: (spec: ConfirmSpec) => Promise<boolean>;
  prompt: (spec: PromptSpec) => Promise<string | null>;
  /** Devuelve la clave escrita, o null si se canceló. Quien llama la verifica. */
  confirmWithPassword: (spec: PasswordSpec) => Promise<string | null>;
};

const Ctx = createContext<DialogApi | null>(null);

/** Acceso al sistema de diálogos. Requiere <DialogProvider> por encima. */
export function useDialog(): DialogApi {
  const api = useContext(Ctx);
  if (!api) throw new Error("useDialog debe usarse dentro de <DialogProvider>");
  return api;
}

export function DialogProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<State>(null);
  const [value, setValue] = useState("");
  const [showPw, setShowPw] = useState(false);
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);

  const open = useCallback((kind: Kind, spec: PromptSpec & PasswordSpec) => {
    setValue(kind === "prompt" ? spec.defaultValue ?? "" : "");
    setShowPw(false);
    return new Promise<never>((resolve) => {
      setState({ ...spec, kind, resolve } as State);
    });
  }, []);

  const api = useMemo<DialogApi>(
    () => ({
      confirm: (spec) => open("confirm", spec) as unknown as Promise<boolean>,
      prompt: (spec) => open("prompt", spec) as unknown as Promise<string | null>,
      confirmWithPassword: (spec) =>
        open("password", spec) as unknown as Promise<string | null>,
    }),
    [open],
  );

  function close(result: unknown) {
    state?.resolve(result as never);
    setState(null);
    setValue("");
    setShowPw(false);
  }

  function cancel() {
    close(state?.kind === "confirm" ? false : null);
  }

  const needsValue = state?.kind === "password" || (state?.kind === "prompt" && state?.required);
  const canConfirm = !needsValue || value.trim().length > 0;

  function accept() {
    if (!canConfirm) return;
    close(state?.kind === "confirm" ? true : value);
  }

  const danger = state?.tone === "danger";

  return (
    <Ctx.Provider value={api}>
      {children}
      <div
        className={"overlay" + (state ? " show" : "")}
        onClick={(e) => { if (e.target === e.currentTarget) cancel(); }}
        onKeyDown={(e) => { if (e.key === "Escape") cancel(); }}
        role={state ? "dialog" : undefined}
        aria-modal={state ? true : undefined}
      >
        {state && (
          <div className="sheet dialog-sheet" style={{ maxWidth: 440 }}>
            <div className="sheet-head">
              <div>
                <div className="sheet-title">{state.title}</div>
                {danger && <div className="dialog-tag-danger">Acción irreversible</div>}
              </div>
              <button className="sheet-close" onClick={cancel} aria-label="Cerrar">✕</button>
            </div>

            {state.message && <p className="dialog-message">{state.message}</p>}
            {state.warning && <div className="dialog-warning">{state.warning}</div>}

            {state.kind === "prompt" && (
              <>
                {state.label && <div className="field-label">{state.label}</div>}
                {state.multiline ? (
                  <textarea
                    ref={(el) => { inputRef.current = el; }}
                    autoFocus
                    className="manage-input"
                    style={{ width: "100%", minHeight: 84 }}
                    value={value}
                    placeholder={state.placeholder}
                    onChange={(e) => setValue(e.target.value)}
                  />
                ) : (
                  <input
                    ref={(el) => { inputRef.current = el; }}
                    autoFocus
                    className="manage-input"
                    style={{ width: "100%" }}
                    value={value}
                    placeholder={state.placeholder}
                    onChange={(e) => setValue(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") accept(); }}
                  />
                )}
              </>
            )}

            {state.kind === "password" && (
              <>
                <div className="field-label">{state.label ?? "Confirma con tu contraseña de administrador"}</div>
                <div className="pw-field">
                  <input
                    ref={(el) => { inputRef.current = el; }}
                    autoFocus
                    className="manage-input"
                    style={{ width: "100%" }}
                    type={showPw ? "text" : "password"}
                    autoComplete="current-password"
                    value={value}
                    placeholder="Contraseña"
                    onChange={(e) => setValue(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") accept(); }}
                  />
                  <button
                    type="button"
                    className="pw-toggle"
                    onClick={() => setShowPw((s) => !s)}
                    aria-label={showPw ? "Ocultar contraseña" : "Mostrar contraseña"}
                  >
                    {showPw ? "Ocultar" : "Mostrar"}
                  </button>
                </div>
              </>
            )}

            <div className="dialog-actions">
              <button className="btn btn-ghost" onClick={cancel}>
                {state.cancelLabel ?? "Cancelar"}
              </button>
              <button
                className={"btn " + (danger ? "btn-danger" : "btn-primary")}
                disabled={!canConfirm}
                onClick={accept}
              >
                {state.confirmLabel ?? "Confirmar"}
              </button>
            </div>
          </div>
        )}
      </div>
    </Ctx.Provider>
  );
}
