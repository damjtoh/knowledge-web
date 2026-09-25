"use client"

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react"
import { Button } from "./ui/button"

type Appearance = "light" | "dark" | "system"

const STORAGE_KEY = "knowledge-reader-appearance"

function readSaved(): Appearance {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY)

    if (saved === "light" || saved === "dark" || saved === "system") return saved
  } catch {}

  return "system"
}

function deviceIsDark(): boolean {
  try {
    return window.matchMedia("(prefers-color-scheme: dark)").matches
  } catch {
    return false
  }
}

function applyAppearance(choice: Appearance): void {
  const root = document.documentElement
  const resolved = choice === "system" ? (deviceIsDark() ? "dark" : "light") : choice
  root.classList.toggle("dark", resolved === "dark")
  root.setAttribute("data-appearance", choice === "system" ? "system" : resolved)
}

function SunIcon() {
  return (
    <svg
      aria-hidden="true"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2" />
      <path d="M12 20v2" />
      <path d="m4.93 4.93 1.41 1.41" />
      <path d="m17.66 17.66 1.41 1.41" />
      <path d="M2 12h2" />
      <path d="M20 12h2" />
      <path d="m6.34 17.66-1.41 1.41" />
      <path d="m19.07 4.93-1.41 1.41" />
    </svg>
  )
}

function MoonIcon() {
  return (
    <svg
      aria-hidden="true"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
    </svg>
  )
}

function MonitorIcon() {
  return (
    <svg
      aria-hidden="true"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect width="20" height="14" x="2" y="3" rx="2" />
      <line x1="8" x2="16" y1="21" y2="21" />
      <line x1="12" x2="12" y1="17" y2="21" />
    </svg>
  )
}

interface AppearanceValue {
  appearance: Appearance
  choose: (choice: Appearance) => void
}

const AppearanceContext = createContext<AppearanceValue | null>(null)

/**
 * Single mounted appearance choice for the reader shell.
 *
 * One provider at the shell root keeps the desktop SidebarFooter and the
 * phone drawer footer in sync. Choosing a mode never starts an offline
 * save; it only applies the theme and stores the explicit choice locally.
 * The head inline script applies the saved choice before first paint so
 * Light/Dark/System restores without a flash.
 */
export function useAppearance(): AppearanceValue {
  const value = useContext(AppearanceContext)

  if (!value) throw new Error("useAppearance must be used within AppearanceProvider.")

  return value
}

export function AppearanceProvider({ children }: { children: React.ReactNode }) {
  const [appearance, setAppearance] = useState<Appearance>("system")

  useEffect(() => {
    const initial = readSaved()
    setAppearance(initial)
    applyAppearance(initial)
    const media = window.matchMedia("(prefers-color-scheme: dark)")

    const onChange = () => {
      try {
        const current = window.localStorage.getItem(STORAGE_KEY)

        if (current !== "light" && current !== "dark") applyAppearance("system")
      } catch {
        applyAppearance("system")
      }
    }

    media.addEventListener("change", onChange)

    return () => media.removeEventListener("change", onChange)
  }, [])

  const choose = useCallback((choice: Appearance) => {
    setAppearance(choice)

    try {
      window.localStorage.setItem(STORAGE_KEY, choice)
    } catch {}

    applyAppearance(choice)
  }, [])

  const value = useMemo(() => ({ appearance, choose }), [appearance, choose])

  return <AppearanceContext.Provider value={value}>{children}</AppearanceContext.Provider>
}

/**
 * Appearance control: Light, Dark, System.
 *
 * Built on the official shadcn Button registry component. Icons are inline
 * SVG so the reader adds no icon runtime dependency. System is the initial
 * state when nothing is saved and follows later device changes via
 * matchMedia. An explicit Light/Dark/System choice is saved locally and
 * restored on later visits (plus the head inline script applies it before
 * first paint). Native buttons keep keyboard operation; aria-pressed
 * exposes the selected state under the "Appearance" group name.
 */
export default function AppearanceControl() {
  const { appearance, choose } = useAppearance()

  const options: { value: Appearance; label: string; Icon: () => React.JSX.Element }[] = [
    { value: "light", label: "Light", Icon: SunIcon },
    { value: "dark", label: "Dark", Icon: MoonIcon },
    { value: "system", label: "System", Icon: MonitorIcon },
  ]

  return (
    <div
      role="group"
      aria-label="Appearance"
      className="reader-appearance"
      data-appearance={appearance}
    >
      {options.map(({ value, label, Icon }) => {
        const selected = appearance === value

        return (
          <Button
            key={value}
            type="button"
            variant={selected ? "secondary" : "ghost"}
            size="sm"
            aria-pressed={selected}
            data-selected={selected ? "true" : undefined}
            title={`${label} appearance`}
            onClick={() => choose(value)}
            className="reader-appearance-option"
          >
            <Icon />
            <span>{label}</span>
          </Button>
        )
      })}
    </div>
  )
}
