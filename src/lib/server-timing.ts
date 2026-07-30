// Production-safe request instrumentation via the standard `Server-Timing`
// response header (visible in browser devtools + APM tools). Emits DURATIONS
// only — never request bodies, params, identities, or secrets — so it is safe
// to always send. No sampling needed: it's a small header, not a log write.
//
//   const t = new ServerTiming();
//   t.start("db"); ...work...; t.end("db");
//   const res = NextResponse.json(data);
//   t.apply(res);          // sets the Server-Timing header (adds `total`)
export class ServerTiming {
  private t0 = Date.now();
  private starts = new Map<string, number>();
  private marks: { name: string; dur: number; desc?: string }[] = [];

  start(name: string): void {
    this.starts.set(name, Date.now());
  }
  end(name: string, desc?: string): void {
    const s = this.starts.get(name);
    if (s != null) this.marks.push({ name, dur: Date.now() - s, desc });
  }
  /** Record a pre-measured duration (e.g. docsExamined as a metric). */
  add(name: string, dur: number, desc?: string): void {
    this.marks.push({ name, dur, desc });
  }
  header(): string {
    const parts = this.marks.map(
      (m) => `${m.name};dur=${m.dur}${m.desc ? `;desc="${m.desc.replace(/"/g, "")}"` : ""}`,
    );
    parts.push(`total;dur=${Date.now() - this.t0}`);
    return parts.join(", ");
  }
  /** Attach the header to a response and return it. */
  apply<T extends { headers: Headers }>(res: T): T {
    res.headers.set("Server-Timing", this.header());
    return res;
  }
}
