"use client"

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react"
import { Monitor, Moon, Palette, Sun } from "lucide-react"
import { ToggleGroup, ToggleGroupItem } from "./ui/toggle-group"

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
 * Segmented control built on the registry ToggleGroup (single-select) in a
 * muted pill. Sun/moon/monitor icons are lucide only; each option keeps
 * its readable name in a screen-reader label so keyboard and assistive
 * operation stay explicit. System is the initial state when nothing is
 * saved and follows later device changes via matchMedia. An explicit
 * Light/Dark/System choice is saved locally and restored on later
 * visits (plus the head inline script applies it before first paint).
 * Theme switching behavior and persistence come from the existing
 * AppearanceProvider logic, unchanged here.
 */
export default function AppearanceControl() {
  const { appearance, choose } = useAppearance()

  const options: { value: Appearance; label: string; Icon: typeof Sun }[] = [
    { value: "light", label: "Light", Icon: Sun },
    { value: "dark", label: "Dark", Icon: Moon },
    { value: "system", label: "System", Icon: Monitor },
  ]

  return (
    <div
      role="group"
      aria-label="Appearance"
      className="reader-appearance flex flex-col gap-2"
      data-appearance={appearance}
    >
      <div className="flex items-center gap-1.5">
        <span className="text-2xs font-semibold tracking-label text-muted-foreground">
          APPEARANCE
        </span>
        <Palette aria-hidden="true" className="size-3 text-muted-foreground ml-auto" />
      </div>
      <ToggleGroup
        value={[appearance]}
        onValueChange={(groupValue) => {
          const next = groupValue[0]

          if (next === "light" || next === "dark" || next === "system") choose(next)
        }}
        aria-label="Appearance options"
        className="bg-muted rounded-full p-0.5 gap-0.5 w-full"
      >
        {options.map(({ value, label, Icon }) => (
          <ToggleGroupItem
            key={value}
            value={value}
            title={`${label} appearance`}
            aria-label={`${label} appearance`}
            className="reader-appearance-option flex-1 rounded-full border border-transparent p-1.5 justify-center text-muted-foreground aria-pressed:bg-card aria-pressed:border-border aria-pressed:text-primary"
          >
            <Icon aria-hidden="true" className="size-3" />
            <span className="sr-only">{label}</span>
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </div>
  )
}
