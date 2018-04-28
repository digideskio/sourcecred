// @flow

import tmp from "tmp";

import {createExampleRepo} from "./demoData/exampleRepo";
import {makeUtils} from "./gitUtils";
import {loadRepository} from "./loadRepository";

const cleanups: (() => void)[] = [];
afterAll(() => {
  cleanups.forEach((f) => {
    f();
  });
});

function mkdtemp() {
  const result = tmp.dirSync({unsafeCleanup: true});
  cleanups.push(() => result.removeCallback());
  return result.name;
}

describe("loadRepository", () => {
  it("loads from HEAD", () => {
    const repository = createExampleRepo(mkdtemp());
    expect(loadRepository(repository.path, "HEAD")).toMatchSnapshot();
  });

  it("processes an old commit", () => {
    const repository = createExampleRepo(mkdtemp());
    const whole = loadRepository(repository.path, "HEAD");
    const part = loadRepository(repository.path, repository.commits[1]);

    // Check that `part` is a subset of `whole`...
    Object.keys(part.commits).forEach((hash) => {
      expect(part.commits[hash]).toEqual(whole.commits[hash]);
    });
    Object.keys(part.trees).forEach((hash) => {
      expect(part.trees[hash]).toEqual(whole.trees[hash]);
    });

    // ...and that it's the right subset.
    expect({
      commits: new Set(Object.keys(part.commits)),
      trees: new Set(Object.keys(part.trees)),
    }).toMatchSnapshot();
  });
});