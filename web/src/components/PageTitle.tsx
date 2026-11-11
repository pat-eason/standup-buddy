import { createContext, useContext, useEffect, useRef, type ReactNode } from 'react';

export interface TopbarTitle {
  text: string;
  /** True once the page's own heading has scrolled up under the top bar. */
  hidden: boolean;
}

type Report = (title: TopbarTitle | null) => void;

const TopbarTitleContext = createContext<Report>(() => undefined);

export function TopbarTitleProvider({ report, children }: { report: Report; children: ReactNode }) {
  return <TopbarTitleContext.Provider value={report}>{children}</TopbarTitleContext.Provider>;
}

/** Height of the blurred top bar; the heading counts as "gone" once it passes under it. */
const TOPBAR_OFFSET_PX = 60;

/**
 * A page heading that tells the top bar when it has scrolled out of view, so the bar can
 * show the title in its place.
 */
export function PageTitle({ title }: { title: string }) {
  const report = useContext(TopbarTitleContext);
  const ref = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => report({ text: title, hidden: !entry.isIntersecting && entry.boundingClientRect.top < TOPBAR_OFFSET_PX }),
      { rootMargin: `-${TOPBAR_OFFSET_PX}px 0px 0px 0px`, threshold: 0 },
    );
    observer.observe(el);
    return () => {
      observer.disconnect();
      report(null);
    };
  }, [title, report]);

  return (
    <h1 ref={ref} className="page-title">
      {title}
    </h1>
  );
}
