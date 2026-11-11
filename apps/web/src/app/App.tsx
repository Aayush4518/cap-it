import { useEffect, useState } from "react";
import OverviewPage from "../features/overview/OverviewPage";
import { NotchNav } from "../components/NotchNav";

const sections = [
  { id: "overview", label: "Overview" },
  { id: "playground", label: "Playground" },
  { id: "policies", label: "Policies" },
  { id: "analytics", label: "Analytics" },
  { id: "instances", label: "Instances" },
] as const;

type SectionId = (typeof sections)[number]["id"];
type Theme = "light" | "dark";

function NavIcon({ name }: { name: SectionId }) {
  const common = {
    width: 17,
    height: 17,
    viewBox: "0 0 20 20",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.5,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true as const,
  };

  switch (name) {
    case "overview":
      return <svg {...common}><rect x="2.75" y="2.75" width="5.75" height="5.75" rx="1.2" /><rect x="11.5" y="2.75" width="5.75" height="5.75" rx="1.2" /><rect x="2.75" y="11.5" width="5.75" height="5.75" rx="1.2" /><rect x="11.5" y="11.5" width="5.75" height="5.75" rx="1.2" /></svg>;
    case "playground":
      return <svg {...common}><path d="m7 5-5 5 5 5M13 5l5 5-5 5M11.5 3 8.5 17" /></svg>;
    case "policies":
      return <svg {...common}><path d="M10 2.5 16.5 5v4.6c0 3.8-2.5 6.5-6.5 7.9-4-1.4-6.5-4.1-6.5-7.9V5L10 2.5Z" /><path d="m7.5 10 1.7 1.7 3.6-3.8" /></svg>;
    case "analytics":
      return <svg {...common}><path d="M3 16.5V10M8 16.5V4M13 16.5v-5M18 16.5V7" /></svg>;
    case "instances":
      return <svg {...common}><rect x="3" y="3" width="14" height="5.5" rx="1.3" /><rect x="3" y="11.5" width="14" height="5.5" rx="1.3" /><path d="M6 5.75h.01M6 14.25h.01M9 5.75h5M9 14.25h5" /></svg>;
  }
}

function AppearanceIcon({ theme }: { theme: Theme }) {
  return theme === "light" ? (
    <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
      <path d="M16.1 12.1A6.8 6.8 0 0 1 7.9 3.9a6.8 6.8 0 1 0 8.2 8.2Z" />
    </svg>
  ) : (
    <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
      <circle cx="10" cy="10" r="3.1" /><path d="M10 2v1.5M10 16.5V18M18 10h-1.5M3.5 10H2M15.66 4.34l-1.06 1.06M5.4 14.6l-1.06 1.06m11.32 0-1.06-1.06M5.4 5.4 4.34 4.34" />
    </svg>
  );
}

function readSavedTheme(): Theme {
  try {
    return window.localStorage.getItem("cap-it-theme-v2") === "light" ? "light" : "dark";
  } catch {
    return "light";
  }
}

function App() {
  const [activeSection, setActiveSection] = useState<SectionId>("overview");
  const [theme, setTheme] = useState<Theme>(readSavedTheme);
  const activeLabel = sections.find(({ id }) => id === activeSection)?.label;
  const navItems = sections.map((section) => ({
    ...section,
    icon: <NavIcon name={section.id} />,
  }));

  useEffect(() => {
    document.querySelector('meta[name="theme-color"]')?.setAttribute(
      "content",
      theme === "dark" ? "#191B19" : "#f5f5f2",
    );
    try {
      window.localStorage.setItem("cap-it-theme-v2", theme);
    } catch {
      // The appearance toggle still works for this visit when storage is unavailable.
    }
  }, [theme]);

  return (
    <div className="app-shell" data-theme={theme}>
      <NotchNav
        items={navItems}
        activeId={activeSection}
        onActiveChange={(id) => setActiveSection(id as SectionId)}
        logo={(
          <span className="notch-brand">
            <span className="notch-brand-mark" aria-hidden="true">c</span>
            <span className="notch-brand-name">cap-it</span>
          </span>
        )}
        rightContent={(
          <button
            className="theme-toggle"
            type="button"
            aria-label={`Switch to ${theme === "light" ? "dark" : "light"} mode`}
            title={`Switch to ${theme === "light" ? "dark" : "light"} mode`}
            onClick={() => setTheme((current) => current === "light" ? "dark" : "light")}
          >
            <AppearanceIcon theme={theme} />
            <span>{theme === "light" ? "Dark appearance" : "Light appearance"}</span>
          </button>
        )}
      />

      <main className="main-content">
        <div className="view-transition" key={activeSection}>
          {activeSection === "overview" ? (
            <OverviewPage />
          ) : (
            <section className="page-placeholder" aria-labelledby="placeholder-title">
              <span className="section-kicker">CAP-IT / {activeLabel?.toUpperCase()}</span>
              <h1 id="placeholder-title">{activeLabel}</h1>
              <p>This section is the next part of the dashboard build.</p>
            </section>
          )}
        </div>
      </main>
    </div>
  );
}

export default App;
