import { LayoutGroup, motion, MotionConfig } from "framer-motion";
import { useEffect, useRef, useState, type ReactNode } from "react";
import "./notch-nav.css";

export interface NotchNavItem {
  id: string;
  label: string;
  href: string;
  icon?: ReactNode;
}

interface NotchNavProps {
  items: NotchNavItem[];
  activeId: string;
  onActiveChange: (id: string) => void;
  logo: ReactNode;
  rightContent?: ReactNode;
}

function LeftWing() {
  return (
    <svg className="notch-wing notch-wing-left" viewBox="0 0 20 20" aria-hidden="true">
      <path d="M 0 0 C 11.046 0 20 8.954 20 20 H 21 V -1 H 0 Z" fill="currentColor" />
    </svg>
  );
}

function RightWing() {
  return (
    <svg className="notch-wing notch-wing-right" viewBox="0 0 20 20" aria-hidden="true">
      <path d="M 20 0 C 8.954 0 0 8.954 0 20 H -1 V -1 H 20 Z" fill="currentColor" />
    </svg>
  );
}

export function NotchNav({ items, activeId, onActiveChange, logo, rightContent }: NotchNavProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const mobileNavRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const activeItem = items.find((item) => item.id === activeId) ?? items[0];

  useEffect(() => {
    if (!menuOpen) return;

    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (mobileNavRef.current && !mobileNavRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenuOpen(false);
        menuButtonRef.current?.focus();
      }
    };

    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [menuOpen]);

  const selectItem = (id: string) => {
    const focusMobileTrigger = mobileNavRef.current?.contains(document.activeElement) ?? false;
    onActiveChange(id);
    setMenuOpen(false);
    if (focusMobileTrigger) {
      requestAnimationFrame(() => menuButtonRef.current?.focus());
    }
  };

  return (
    <header className="notch-header">
      <div className="desktop-brand-notch">
        {logo}
        <RightWing />
      </div>

      <nav className="desktop-menu-notch" aria-label="Main navigation">
        <LeftWing />
        <RightWing />
        <MotionConfig reducedMotion="user">
          <LayoutGroup id="cap-it-navigation">
            <div className="desktop-menu-items">
              {items.map((item) => (
                <a
                  className={`notch-link${item.id === activeId ? " is-active" : ""}`}
                  key={item.id}
                  href={item.href}
                  aria-current={item.id === activeId ? "page" : undefined}
                  onClick={(event) => {
                    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                    event.preventDefault();
                    selectItem(item.id);
                  }}
                >
                  {item.id === activeId && (
                    <motion.span
                      className="notch-active-pill"
                      layoutId="cap-it-active-navigation-pill"
                      transition={{ type: "spring", stiffness: 420, damping: 38, mass: 0.9 }}
                    />
                  )}
                  {item.icon && <span className="notch-item-icon">{item.icon}</span>}
                  <span className="notch-item-label">{item.label}</span>
                </a>
              ))}
            </div>
          </LayoutGroup>
        </MotionConfig>
      </nav>

      <div className="desktop-action-notch" aria-label="Appearance controls">
        <LeftWing />
        {rightContent}
      </div>

      <div className="mobile-notch" ref={mobileNavRef}>
        <div className="mobile-notch-bar">
          <div className="mobile-brand">{logo}</div>
          <button
            ref={menuButtonRef}
            className="mobile-menu-trigger"
            type="button"
            aria-expanded={menuOpen}
            aria-haspopup="true"
            aria-controls="mobile-navigation-menu"
            onClick={() => setMenuOpen((open) => !open)}
          >
            {activeItem?.icon && <span className="notch-item-icon">{activeItem.icon}</span>}
            <span>{activeItem?.label}</span>
            <svg className={`menu-chevron${menuOpen ? " is-open" : ""}`} width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="m4 6 4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <div className="mobile-action">{rightContent}</div>
        </div>

        <div id="mobile-navigation-menu" className={`mobile-menu${menuOpen ? " is-open" : ""}`} aria-hidden={!menuOpen}>
          <nav aria-label="Main navigation">
            {items.map((item) => (
              <a
                className={`mobile-menu-item${item.id === activeId ? " is-active" : ""}`}
                key={item.id}
                href={item.href}
                tabIndex={menuOpen ? 0 : -1}
                aria-current={item.id === activeId ? "page" : undefined}
                onClick={(event) => {
                  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                  event.preventDefault();
                  selectItem(item.id);
                }}
              >
                <span className="mobile-menu-item-label">
                  {item.icon && <span className="notch-item-icon">{item.icon}</span>}
                  <span>{item.label}</span>
                </span>
                {item.id === activeId && <span className="mobile-menu-check" aria-hidden="true">✓</span>}
              </a>
            ))}
          </nav>
        </div>
      </div>
    </header>
  );
}
