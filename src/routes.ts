import type { ModuleId } from "./types";

export interface Route {
  module: ModuleId;
  classId?: string;
  studentId?: string;
}

function decodeId(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    // Keep an invalid escaped ID so the app can show its missing-record state.
    return value;
  }
}

/** Parse only complete, supported routes; invalid suffixes return to the module. */
export function parseRoute(hash: string): Route {
  if (!hash.startsWith("#/")) return { module: "one-to-one" };
  const parts = hash.slice(2).split("/");
  const module = parts[0];
  if (module !== "one-to-one" && module !== "evening" && module !== "course") {
    return { module: "one-to-one" };
  }
  if (module === "one-to-one") {
    return parts.length === 3 && parts[1] === "student" && parts[2]
      ? { module, studentId: decodeId(parts[2]) }
      : { module };
  }
  if (parts[1] === "class" && parts[2]) {
    if (parts.length === 3) return { module, classId: decodeId(parts[2]) };
    if (parts.length === 5 && parts[3] === "student" && parts[4]) {
      return {
        module,
        classId: decodeId(parts[2]),
        studentId: decodeId(parts[4]),
      };
    }
  }
  return { module };
}

/** IDs are escaped individually, so slashes and hash characters stay inside IDs. */
export function routeUrl(route: Route): string {
  const base = `#/${route.module}`;
  if (route.module === "one-to-one") {
    return route.studentId
      ? `${base}/student/${encodeURIComponent(route.studentId)}`
      : base;
  }
  if (!route.classId) return base;
  const classPath = `${base}/class/${encodeURIComponent(route.classId)}`;
  return route.studentId
    ? `${classPath}/student/${encodeURIComponent(route.studentId)}`
    : classPath;
}
