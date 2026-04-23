import { ForestRun } from "../ForestRun";
import { gql } from "./helpers/descriptor";

describe("getStats", () => {
  it("returns basic stats without partitions", () => {
    const cache = new ForestRun({
      maxOperationCount: 10,
      autoEvict: false,
    });
    const query = gql`
      query ($i: Int) {
        foo(i: $i)
      }
    `;

    const stats = cache.getStats();
    expect(stats.docCount).toBe(0);
    expect(stats.treeCount).toBe(0);
    expect(stats.nodeCount).toBe(0);
    expect(stats.partitions).toEqual({});

    cache.write({ query, variables: { i: 0 }, result: { foo: 0 } });
    cache.write({ query, variables: { i: 1 }, result: { foo: 1 } });

    const statsAfter = cache.getStats();
    expect(statsAfter.docCount).toBe(1);
    expect(statsAfter.treeCount).toBe(2);
    expect(statsAfter.nodeCount).toBeGreaterThan(0);
  });

  it("returns partition utilization for configured partitions", () => {
    const cache = new ForestRun({
      maxOperationCount: 5,
      autoEvict: false,
      partitionConfig: {
        partitionKey: (o) =>
          o.operation.debugName === "query a" ? "partA" : null,
        partitions: {
          partA: { maxOperationCount: 3 },
        },
      },
    });

    const a = gql`
      query a($i: Int) {
        foo(i: $i)
      }
    `;
    const b = gql`
      query b($i: Int) {
        bar(i: $i)
      }
    `;

    cache.write({ query: a, variables: { i: 0 }, result: { foo: 0 } });
    cache.write({ query: a, variables: { i: 1 }, result: { foo: 1 } });
    cache.write({ query: b, variables: { i: 0 }, result: { bar: 0 } });

    const stats = cache.getStats();

    // partA has 2 operations written
    expect(stats.partitions["partA"]).toEqual({
      operationCount: 2,
      maxOperationCount: 3,
      autoEvict: false,
    });

    // __default__ has 1 operation (query b)
    expect(stats.partitions["__default__"]).toEqual({
      operationCount: 1,
      maxOperationCount: 5,
      autoEvict: false,
    });
  });

  it("reports autoEvict per partition", () => {
    const cache = new ForestRun({
      maxOperationCount: 10,
      autoEvict: true,
      partitionConfig: {
        partitionKey: (o) => o.operation.debugName,
        partitions: {
          "query a": { maxOperationCount: 5, autoEvict: false },
          "query b": { maxOperationCount: 3 },
        },
      },
    });

    const a = gql`
      query a($i: Int) {
        foo(i: $i)
      }
    `;
    const b = gql`
      query b($i: Int) {
        bar(i: $i)
      }
    `;

    cache.write({ query: a, variables: { i: 0 }, result: { foo: 0 } });
    cache.write({ query: b, variables: { i: 0 }, result: { bar: 0 } });

    const stats = cache.getStats();

    expect(stats.partitions["query a"].autoEvict).toBe(false);
    expect(stats.partitions["query a"].maxOperationCount).toBe(5);

    // "query b" inherits autoEvict: true from global setting
    expect(stats.partitions["query b"].autoEvict).toBe(true);
    expect(stats.partitions["query b"].maxOperationCount).toBe(3);
  });

  it("reflects correct counts after eviction", () => {
    const cache = new ForestRun({
      maxOperationCount: 2,
      autoEvict: false,
      partitionConfig: {
        partitionKey: (o) =>
          o.operation.debugName === "query a" ? "partA" : null,
        partitions: {
          partA: { maxOperationCount: 2 },
        },
      },
    });

    const a = gql`
      query a($i: Int) {
        foo(i: $i)
      }
    `;

    cache.write({ query: a, variables: { i: 0 }, result: { foo: 0 } });
    cache.write({ query: a, variables: { i: 1 }, result: { foo: 1 } });
    cache.write({ query: a, variables: { i: 2 }, result: { foo: 2 } });

    const statsBefore = cache.getStats();
    expect(statsBefore.partitions["partA"].operationCount).toBe(3);

    cache.gc();

    const statsAfter = cache.getStats();
    expect(statsAfter.partitions["partA"].operationCount).toBe(2);
  });
});
