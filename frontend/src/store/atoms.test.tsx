import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { Provider, useAtomValue, useSetAtom } from "jotai";
import {
  shortlistAtom,
  addToShortlistAtom,
  removeFromShortlistAtom,
} from "./atoms";

function createWrapper() {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <Provider>{children}</Provider>;
  };
}

describe("shortlist atoms", () => {
  const wrapper = createWrapper();

  it("adds item to shortlist", () => {
    const { result } = renderHook(
      () => ({
        shortlist: useAtomValue(shortlistAtom),
        add: useSetAtom(addToShortlistAtom),
      }),
      { wrapper }
    );

    act(() => {
      result.current.add({
        id: "en-601-226",
        courseCode: "EN.601.226",
        courseTitle: "Data Structures",
      });
    });

    expect(result.current.shortlist).toHaveLength(1);
    expect(result.current.shortlist[0]).toEqual({
      id: "en-601-226",
      courseCode: "EN.601.226",
      courseTitle: "Data Structures",
    });
  });

  it("removes item from shortlist", () => {
    const { result } = renderHook(
      () => ({
        shortlist: useAtomValue(shortlistAtom),
        add: useSetAtom(addToShortlistAtom),
        remove: useSetAtom(removeFromShortlistAtom),
      }),
      { wrapper }
    );

    act(() => {
      result.current.add({
        id: "en-601-226",
        courseCode: "EN.601.226",
        courseTitle: "Data Structures",
      });
    });

    expect(result.current.shortlist).toHaveLength(1);

    act(() => {
      result.current.remove("en-601-226");
    });

    expect(result.current.shortlist).toHaveLength(0);
  });

  it("deduplicates when same id is added twice", () => {
    const { result } = renderHook(
      () => ({
        shortlist: useAtomValue(shortlistAtom),
        add: useSetAtom(addToShortlistAtom),
      }),
      { wrapper }
    );

    const item = {
      id: "en-601-226",
      courseCode: "EN.601.226",
      courseTitle: "Data Structures",
    };

    act(() => {
      result.current.add(item);
    });

    act(() => {
      result.current.add(item);
    });

    expect(result.current.shortlist).toHaveLength(1);
    expect(result.current.shortlist[0].id).toBe("en-601-226");
  });
});
