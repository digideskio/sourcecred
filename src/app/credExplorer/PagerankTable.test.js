// @flow
import React from "react";
import {shallow} from "enzyme";
import enzymeToJSON from "enzyme-to-json";

import {
  PagerankTable,
  NodeRowList,
  NodeRow,
  ContributionRowList,
  ContributionRow,
  ContributionView,
} from "./PagerankTable";
import {pagerank} from "../../core/attribution/pagerank";
import sortBy from "lodash.sortby";

import {
  Graph,
  type NodeAddressT,
  Direction,
  NodeAddress,
  EdgeAddress,
} from "../../core/graph";

require("../testUtil").configureEnzyme();

const COLUMNS = () => ["Description", "Contribution", "Score"];

function example() {
  const graph = new Graph();
  const nodes = {
    fooAlpha: NodeAddress.fromParts(["foo", "a", "1"]),
    fooBeta: NodeAddress.fromParts(["foo", "b", "2"]),
    bar1: NodeAddress.fromParts(["bar", "a", "1"]),
    bar2: NodeAddress.fromParts(["bar", "2"]),
    xox: NodeAddress.fromParts(["xox"]),
    empty: NodeAddress.empty,
  };
  Object.values(nodes).forEach((n) => graph.addNode((n: any)));

  function addEdge(parts, src, dst) {
    const edge = {address: EdgeAddress.fromParts(parts), src, dst};
    graph.addEdge(edge);
    return edge;
  }

  const edges = {
    fooA: addEdge(["foo", "a"], nodes.fooAlpha, nodes.fooBeta),
    fooB: addEdge(["foo", "b"], nodes.fooAlpha, nodes.bar1),
    fooC: addEdge(["foo", "c"], nodes.fooAlpha, nodes.xox),
    barD: addEdge(["bar", "d"], nodes.bar1, nodes.bar1),
    barE: addEdge(["bar", "e"], nodes.bar1, nodes.xox),
    barF: addEdge(["bar", "f"], nodes.bar1, nodes.xox),
  };

  const adapters = [
    {
      name: () => "foo",
      graph: () => {
        throw new Error("unused");
      },
      renderer: () => ({
        nodeDescription: (x) => `foo: ${NodeAddress.toString(x)}`,
        edgeVerb: (_unused_e, direction) =>
          direction === "FORWARD" ? "foos" : "is fooed by",
      }),
      nodePrefix: () => NodeAddress.fromParts(["foo"]),
      edgePrefix: () => EdgeAddress.fromParts(["foo"]),
      nodeTypes: () => [
        {name: "alpha", prefix: NodeAddress.fromParts(["foo", "a"])},
        {name: "beta", prefix: NodeAddress.fromParts(["foo", "b"])},
      ],
    },
    {
      name: () => "bar",
      graph: () => {
        throw new Error("unused");
      },
      renderer: () => ({
        nodeDescription: (x) => `bar: ${NodeAddress.toString(x)}`,
        edgeVerb: (_unused_e, direction) =>
          direction === "FORWARD" ? "bars" : "is barred by",
      }),
      nodePrefix: () => NodeAddress.fromParts(["bar"]),
      edgePrefix: () => EdgeAddress.fromParts(["bar"]),
      nodeTypes: () => [
        {name: "alpha", prefix: NodeAddress.fromParts(["bar", "a"])},
      ],
    },
    {
      name: () => "xox",
      graph: () => {
        throw new Error("unused");
      },
      renderer: () => ({
        nodeDescription: (_unused_arg) => `xox node!`,
        edgeVerb: (_unused_e, _unused_direction) => `xox'd`,
      }),
      nodePrefix: () => NodeAddress.fromParts(["xox"]),
      edgePrefix: () => EdgeAddress.fromParts(["xox"]),
      nodeTypes: () => [],
    },
    {
      name: () => "unused",
      graph: () => {
        throw new Error("unused");
      },
      renderer: () => {
        throw new Error("Impossible!");
      },
      nodePrefix: () => NodeAddress.fromParts(["unused"]),
      edgePrefix: () => EdgeAddress.fromParts(["unused"]),
      nodeTypes: () => [],
    },
  ];

  const pnd = pagerank(graph, (_unused_Edge) => ({
    toWeight: 1,
    froWeight: 1,
  }));

  return {adapters, nodes, edges, graph, pnd};
}

describe("app/credExplorer/PagerankTable", () => {
  function verifyNoAdapterWarning() {
    expect(console.warn).toHaveBeenCalledWith("No adapter for NodeAddress[]");
    expect(console.warn).toHaveBeenCalledTimes(1);
    // $ExpectFlowError
    console.warn = jest.fn();
  }
  beforeEach(() => {
    // $ExpectFlowError
    console.error = jest.fn();
    // $ExpectFlowError
    console.warn = jest.fn();
  });
  afterEach(() => {
    expect(console.warn).not.toHaveBeenCalled();
    expect(console.error).not.toHaveBeenCalled();
  });

  describe("PagerankTable", () => {
    it("renders expected message with null props", () => {
      const element = shallow(
        <PagerankTable pnd={null} adapters={null} maxEntriesPerList={1} />
      );
      expect(enzymeToJSON(element)).toMatchSnapshot();
    });
    it("renders expected message with just adapters", () => {
      const {adapters} = example();
      const element = shallow(
        <PagerankTable pnd={null} adapters={adapters} maxEntriesPerList={1} />
      );
      expect(enzymeToJSON(element)).toMatchSnapshot();
    });
    it("throws an error if maxEntriesPerlist not set", () => {
      const {pnd, adapters} = example();
      expect(() =>
        shallow(
          <PagerankTable
            pnd={pnd}
            adapters={adapters}
            // $ExpectFlowError
            maxEntriesPerList={null}
          />
        )
      ).toThrowError("maxEntriesPerList");
    });

    describe("has a filter select", () => {
      function filterSetup() {
        const {pnd, adapters} = example();
        const element = shallow(
          <PagerankTable pnd={pnd} adapters={adapters} maxEntriesPerList={1} />
        );
        const label = element.find("label");
        const options = label.find("option");
        return {pnd, adapters, element, label, options};
      }
      it("with expected label text", () => {
        const {label} = filterSetup();
        const filterText = label
          .find("span")
          .first()
          .text();
        expect(filterText).toMatchSnapshot();
      });
      it("with expected option groups", () => {
        const {options} = filterSetup();
        const optionsJSON = options.map((o) => ({
          valueString: NodeAddress.toString(o.prop("value")),
          style: o.prop("style"),
          text: o.text(),
        }));
        expect(optionsJSON).toMatchSnapshot();
      });
      it("with the ability to filter nodes passed to NodeRowList", () => {
        const {element, options} = filterSetup();
        const option1 = options.at(1);
        const value = option1.prop("value");
        expect(value).not.toEqual(NodeAddress.empty);
        const previousNodes = element.find("NodeRowList").prop("nodes");
        expect(
          previousNodes.every((n) => NodeAddress.hasPrefix(n, value))
        ).toBe(false);
        element.find("select").simulate("change", {target: {value}});
        const actualNodes = element.find("NodeRowList").prop("nodes");
        expect(actualNodes.every((n) => NodeAddress.hasPrefix(n, value))).toBe(
          true
        );
        expect(actualNodes).not.toHaveLength(0);
      });
    });
    it("renders thead column order properly", () => {
      const {pnd, adapters} = example();
      const element = shallow(
        <PagerankTable pnd={pnd} adapters={adapters} maxEntriesPerList={1} />
      );
      const th = element.find("thead th");
      const columnNames = th.map((t) => t.text());
      expect(columnNames).toEqual(COLUMNS());
    });

    describe("creates a NodeRowList", () => {
      function setupNodeRowList() {
        const {adapters, pnd} = example();
        const maxEntriesPerList = 1;
        const element = shallow(
          <PagerankTable
            pnd={pnd}
            adapters={adapters}
            maxEntriesPerList={maxEntriesPerList}
          />
        );
        const nrl = element.find("NodeRowList");
        return {adapters, pnd, element, nrl, maxEntriesPerList};
      }
      it("NodeRowList is passed SharedProps appropriately", () => {
        const {nrl, adapters, pnd, maxEntriesPerList} = setupNodeRowList();
        const expectedSharedProps = {adapters, pnd, maxEntriesPerList};
        expect(nrl.prop("sharedProps")).toEqual(expectedSharedProps);
      });
      it("by default, all nodes are passed to NodeRowList", () => {
        const {nrl, pnd} = setupNodeRowList();
        const expectedNodes = Array.from(pnd.keys());
        expect(nrl.prop("nodes")).toEqual(expectedNodes);
      });
    });
  });

  describe("NodeRowList", () => {
    it("creates NodeRows with the right props", () => {});
    it("creates up to maxEntriesPerList NodeRows", () => {});
    it("NodeRows are sorted by score", () => {});
  });
  describe("NodeRow", () => {});
  describe("ContributionRowList", () => {});
  describe("ContributionRow", () => {});
  describe("ContributionView", () => {});
});
