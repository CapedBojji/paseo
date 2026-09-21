import { describe, expect, it } from "vitest";
import { getOpenAgentTabLabel } from "@getpaseo/protocol/agent-labels";
import { buildAgentLsFetchOptions, filterAgentsByOpenTab } from "./ls.js";

describe("buildAgentLsFetchOptions", () => {
  it("fetches active agents by default", () => {
    expect(buildAgentLsFetchOptions({})).toEqual({
      scope: "active",
    });
  });

  it("keeps label and thinking filters within the active scope", () => {
    expect(
      buildAgentLsFetchOptions({
        label: ["surface=workspace"],
        thinking: " medium ",
      }),
    ).toEqual({
      scope: "active",
      filter: {
        labels: { surface: "workspace" },
        thinkingOptionId: "medium",
      },
    });
  });

  it("fetches global non-archived agents for -g", () => {
    expect(buildAgentLsFetchOptions({ global: true })).toEqual({});
  });

  it("keeps -a within the active scope", () => {
    expect(buildAgentLsFetchOptions({ all: true })).toEqual({
      scope: "active",
      filter: {
        includeArchived: true,
      },
    });
  });

  it("fetches all global agents for -a -g", () => {
    expect(buildAgentLsFetchOptions({ all: true, global: true })).toEqual({
      filter: {
        includeArchived: true,
      },
    });
  });

  it("applies filters to global queries", () => {
    expect(
      buildAgentLsFetchOptions({
        global: true,
        label: ["surface=workspace"],
        thinking: " medium ",
      }),
    ).toEqual({
      filter: {
        labels: { surface: "workspace" },
        thinkingOptionId: "medium",
      },
    });
  });
});

describe("filterAgentsByOpenTab", () => {
  it("keeps only agents with an open Paseo tab on any client", () => {
    const label = getOpenAgentTabLabel("client-1");
    const agents = [
      { id: "open", labels: { [label]: "true" } },
      { id: "closed", labels: { [label]: "false" } },
      { id: "unlabelled", labels: {} },
    ];

    expect(filterAgentsByOpenTab(agents, true)).toEqual([agents[0]]);
    expect(filterAgentsByOpenTab(agents, false)).toEqual(agents);
  });
});
