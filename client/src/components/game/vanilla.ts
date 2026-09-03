// Minimal stand-ins for the React primitives used by the ported game
// controllers. The original hooks were almost framework-free: they only
// used useCallback (memoization, irrelevant outside React) and useRef
// (a mutable box). useState/useEffect usages were rewritten by hand at
// the call sites during the port.

export type MutableRef<T> = { current: T };
export type RefObject<T> = { current: T };
export type Dispatch<A> = (action: A) => void;
export type SetStateAction<T> = T | ((previous: T) => T);

export function useCallback<T extends (...args: any[]) => any>(
    fn: T,
    _deps?: unknown,
): T {
    return fn;
}

export function useRef<T>(initial: T): MutableRef<T> {
    return { current: initial };
}
