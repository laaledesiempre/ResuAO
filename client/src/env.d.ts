// Ambient declaration for the handful of process.env references in code
// ported from the Next.js frontend (values are inlined by esbuild `define`).
declare const process: {
    env: Record<string, string | undefined>;
};
