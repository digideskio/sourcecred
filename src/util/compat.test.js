// @flow

import {toCompat, fromCompat} from "./compat";
import type {Compatible} from "./compat";

describe("compat utilities", () => {
  type FooV1 = {foo: number};
  type FooV2 = {bar: {foo: number}};
  const type = "Foo Plugin's Experiment";
  const v1 = "v1";
  const v2 = "v2";
  function fooV1ToV2(x: FooV1): FooV2 {
    return {bar: x};
  }
  const example = () => {
    const dataV1: FooV1 = {foo: 1};
    const dataV2: FooV2 = {bar: {foo: 1}};
    const compatV1 = toCompat({type, version: v1}, dataV1);
    const compatV2 = toCompat({type, version: v2}, dataV2);
    return {dataV1, dataV2, compatV1, compatV2};
  };

  it("toCompat doesn't fails on primitives", () => {
    expect(
      fromCompat({type, version: v1}, toCompat({type, version: v1}, 3))
    ).toBe(3);
  });

  it("toCompat -> fromCompat is identity", () => {
    const {dataV1, compatV1} = example();
    expect(fromCompat({type, version: v1}, compatV1)).toEqual(dataV1);
  });

  it("fromCompat fails if compatibility undefined", () => {
    const dataV1: any = example().dataV1;
    expect(() => fromCompat({type, version: v1}, dataV1)).toThrowError(
      "didn't have compatibility defined"
    );
  });

  it("fromCompat fails if type is wrong", () => {
    const {compatV1} = example();
    expect(() =>
      fromCompat({type: "who is Foo?", version: v1}, compatV1)
    ).toThrowError("Expected type");
  });

  it("fromCompat fails if version is wrong", () => {
    const {compatV1} = example();
    expect(() => fromCompat({type, version: v2}, compatV1)).toThrowError(
      "unsupported version"
    );
  });

  it("handlers can load older versions", () => {
    const {compatV1, dataV2} = example();
    const handlers = {[v1]: fooV1ToV2};
    expect(fromCompat({type: type, version: v2}, compatV1, handlers)).toEqual(
      dataV2
    );
  });

  it("handlers activate even on current version", () => {
    const {compatV1} = example();
    const handlers = {
      [v1]: () => ({
        hello: "world",
      }),
    };
    expect(fromCompat({type, version: v1}, compatV1, handlers)).toEqual({
      hello: "world",
    });
  });

  describe("composable versioning", () => {
    class InnerV1 {
      x: number;
      constructor(x: number) {
        this.x = x;
      }
      toJSON(): Compatible<FooV1> {
        return toCompat({type: "inner", version: v1}, {foo: this.x});
      }
      static fromJSON(json): InnerV1 {
        const from: FooV1 = fromCompat({type: "inner", version: v1}, json);
        return new InnerV1(from.foo);
      }
    }

    class InnerV2 {
      x: number;
      constructor(x: number) {
        this.x = x;
      }
      toJSON(): Compatible<FooV2> {
        return toCompat({type: "inner", version: v2}, {bar: {foo: this.x}});
      }
      static fromJSON(json): InnerV2 {
        const from: FooV2 = fromCompat({type: "inner", version: v2}, json, {
          [v1]: fooV1ToV2,
        });
        return new InnerV2(from.bar.foo);
      }
    }

    class OuterV1 {
      platypus: InnerV1 | InnerV2;
      constructor(i: InnerV1 | InnerV2) {
        this.platypus = i;
      }
      toJSON() {
        return toCompat(
          {type: "outer", version: v1},
          {platypus: this.platypus.toJSON()}
        );
      }
      fromJSON(json: any): OuterV1 {
        return fromCompat({type: "outer", version: v1}, json, {
          [v1]: function(x) {
            return new OuterV1(InnerV2.fromJSON(x.platypus));
          },
        });
      }
    }

    class OuterV2 {
      // Naming this property "platypus" in the previous version was silly
      inner: InnerV1 | InnerV2;
      constructor(i: InnerV1 | InnerV2) {
        this.inner = i;
      }
      toJSON() {
        return toCompat(
          {type: "outer", version: v2},
          {inner: this.inner.toJSON()}
        );
      }
      static fromJSON(json: any): OuterV2 {
        return fromCompat({type: "outer", version: v2}, json, {
          [v1]: function(x) {
            return new OuterV2(InnerV2.fromJSON(x.platypus));
          },
          [v2]: function(x) {
            return new OuterV2(InnerV2.fromJSON(x.inner));
          },
        });
      }
    }

    const canonical = () => new OuterV2(new InnerV2(1));
    it("loads OuterV1<InnerV1>", () => {
      const json = new OuterV1(new InnerV1(1)).toJSON();
      expect(OuterV2.fromJSON(json)).toEqual(canonical());
    });
    it("loads OuterV1<InnerV2>", () => {
      const json = new OuterV1(new InnerV2(1)).toJSON();
      expect(OuterV2.fromJSON(json)).toEqual(canonical());
    });
    it("loads OuterV2<InnerV1>", () => {
      const json = new OuterV2(new InnerV1(1)).toJSON();
      expect(OuterV2.fromJSON(json)).toEqual(canonical());
    });
    it("loads OuterV2<InnerV2>", () => {
      const json = new OuterV2(new InnerV2(1)).toJSON();
      expect(OuterV2.fromJSON(json)).toEqual(canonical());
    });
  });
});
