import { describe, expect, it } from "vitest";
import { parseRoute, routeUrl, type Route } from "./routes";

describe("hash routes", () => {
  it.each<Route>([
    { module: "one-to-one" },
    { module: "one-to-one", studentId: "student-1" },
    { module: "evening" },
    { module: "evening", classId: "class-1" },
    { module: "evening", classId: "class-1", studentId: "student-1" },
    { module: "course" },
    { module: "course", classId: "class-2" },
    { module: "course", classId: "class-2", studentId: "student-2" },
  ])("round-trips supported route $module $classId $studentId", (route) => {
    expect(parseRoute(routeUrl(route))).toEqual(route);
  });

  it.each([
    "/",
    "#",
    "%",
    "七年级 A 班",
    "学生🧮",
    "class",
    "student",
    "constructor",
    "__proto__",
    "a/b#c%20",
  ])(
    "round-trips special ID %s without interpreting it as route structure",
    (id) => {
      const individual: Route = { module: "one-to-one", studentId: id };
      const grouped: Route = { module: "course", classId: id, studentId: id };
      expect(parseRoute(routeUrl(individual))).toEqual(individual);
      expect(parseRoute(routeUrl(grouped))).toEqual(grouped);
    },
  );

  it("encodes every ID independently and includes the hash prefix", () => {
    expect(
      routeUrl({ module: "evening", classId: "初一/A", studentId: "学生#50%" }),
    ).toBe(
      "#/evening/class/%E5%88%9D%E4%B8%80%2FA/student/%E5%AD%A6%E7%94%9F%2350%25",
    );
    expect(parseRoute("#/one-to-one/student/a%252Fb")).toEqual({
      module: "one-to-one",
      studentId: "a%2Fb",
    });
  });

  it.each([
    "",
    "#",
    "#/",
    "#/missing",
    "#/constructor",
    "#/toString",
    "#/__proto__",
    "#/constructor/class/c/student/s",
    "#/one-to-one-extra",
    "evening",
    "#evening",
    "/evening",
  ])(
    "returns the one-to-one module for unknown or malformed root %s",
    (hash) => {
      expect(parseRoute(hash)).toEqual({ module: "one-to-one" });
    },
  );

  it.each([
    ["#/one-to-one/class/c", "one-to-one"],
    ["#/one-to-one/student", "one-to-one"],
    ["#/one-to-one/student/", "one-to-one"],
    ["#/one-to-one/student/s/extra", "one-to-one"],
    ["#/evening/student/s", "evening"],
    ["#/evening/class", "evening"],
    ["#/evening/class/", "evening"],
    ["#/evening/class/c/student", "evening"],
    ["#/course/class/c/student/", "course"],
    ["#/course/class/c/student/s/extra", "course"],
    ["#/course/unknown/c/student/s", "course"],
    ["#/course/class//student/s", "course"],
  ])("does not extract partial IDs from invalid route %s", (hash, module) => {
    expect(parseRoute(hash)).toEqual({ module });
  });

  it.each(["%", "%ZZ", "%E0%A4%A", "%ED%A0%80"])(
    "preserves malformed encoding %s without crashing",
    (id) => {
      expect(parseRoute(`#/one-to-one/student/${id}`)).toEqual({
        module: "one-to-one",
        studentId: id,
      });
      expect(parseRoute(`#/evening/class/${id}/student/${id}`)).toEqual({
        module: "evening",
        classId: id,
        studentId: id,
      });
    },
  );

  it("generates canonical module paths for unsupported ID combinations", () => {
    expect(
      routeUrl({ module: "one-to-one", classId: "unused", studentId: "s" }),
    ).toBe("#/one-to-one/student/s");
    expect(routeUrl({ module: "evening", studentId: "s" })).toBe("#/evening");
    expect(routeUrl({ module: "course", classId: "", studentId: "s" })).toBe(
      "#/course",
    );
  });
});
