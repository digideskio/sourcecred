// @flow

import * as R from "./relationalView";
import * as N from "./nodes";
import {exampleData, exampleRelationalView} from "./example/example";

describe("plugins/github/relationalView", () => {
  // Sharing this state is OK because it's just a view - no mutation allowed!
  const view = exampleRelationalView();

  function hasEntities(name, method) {
    describe(name, () => {
      const all = Array.from(method());
      it(`has expected number of ${name}`, () => {
        expect(all.length).toMatchSnapshot();
      });
      it("have expected urls", () => {
        expect(all.map((x) => x.url())).toMatchSnapshot();
      });
    });
  }

  function has(name, method) {
    it(`has ${name}`, () => {
      const element = method();
      let snapshot;
      if (element instanceof R._Entity) {
        // element is an Entity. Entities have pointers to the RelationalView,
        // and it would pollute our snapshot horribly. Just show the url.
        snapshot = {url: element.url()};
      } else {
        snapshot = element;
      }
      expect(snapshot).toMatchSnapshot();
    });
  }

  describe("RelationalView", () => {
    function hasEntityMethods<T: R._Entity<any>>(
      name,
      getAll: () => Iterator<T>,
      get: (x: $Call<$PropertyType<T, "address">>) => ?T
    ) {
      describe(`entity: ${name}`, () => {
        const all = Array.from(getAll());
        it("has expected number of them", () => {
          expect(all.length).not.toEqual(0);
          expect(all.length).toMatchSnapshot();
        });
        const one = all[0];
        it("they are retrievable by address", () => {
          expect(get(one.address())).toEqual(one);
        });
        it("they have expected urls", () => {
          expect(all.map((x) => x.url())).toMatchSnapshot();
        });
      });
    }
    hasEntityMethods("repos", () => view.repos(), (x) => view.repo(x));
    hasEntityMethods("issues", () => view.issues(), (x) => view.issue(x));
    hasEntityMethods("pulls", () => view.pulls(), (x) => view.pull(x));
    hasEntityMethods("reviews", () => view.reviews(), (x) => view.review(x));
    hasEntityMethods("comments", () => view.comments(), (x) => view.comment(x));
    hasEntityMethods(
      "userlikes",
      () => view.userlikes(),
      (x) => view.userlike(x)
    );
  });

  const repo = view.repo({
    type: N.REPO_TYPE,
    owner: "sourcecred",
    name: "example-github",
  });
  if (repo == null) {
    throw new Error("Error: sourcecred/example-github must exist!");
  }
  describe("Repo", () => {
    const entity = repo;
    has("owner", () => entity.owner());
    has("name", () => entity.name());
    has("url", () => entity.url());
    hasEntities("issues", () => entity.issues());
    hasEntities("pulls", () => entity.pulls());
  });

  const issue = Array.from(repo.issues())[1];
  describe("Issue", () => {
    const entity = issue;
    has("number", () => entity.number());
    has("body", () => entity.body());
    has("title", () => entity.title());
    has("url", () => entity.url());
    has("parent", () => entity.parent());
    hasEntities("comments", () => entity.comments());
    hasEntities("authors", () => entity.authors());
  });

  const pull = Array.from(repo.pulls())[1];
  describe("Pull", () => {
    const entity = pull;
    has("number", () => entity.number());
    has("body", () => entity.body());
    has("title", () => entity.title());
    has("url", () => entity.url());
    has("parent", () => entity.parent());
    has("mergedAs", () => entity.mergedAs());
    has("additions", () => entity.additions());
    has("deletions", () => entity.deletions());
    hasEntities("reviews", () => entity.reviews());
    hasEntities("comments", () => entity.comments());
    hasEntities("authors", () => entity.authors());
  });

  const review = Array.from(pull.reviews())[0];
  describe("Review", () => {
    const entity = review;
    has("body", () => entity.body());
    has("url", () => entity.url());
    has("state", () => entity.state());
    has("parent", () => entity.parent());
    hasEntities("comments", () => entity.comments());
    hasEntities("authors", () => entity.authors());
  });

  const comment = Array.from(review.comments())[0];
  describe("Comment", () => {
    const entity = comment;
    has("body", () => entity.body());
    has("url", () => entity.url());
    has("parent", () => entity.parent());
    hasEntities("authors", () => entity.authors());
  });

  const userlike = Array.from(review.authors())[0];
  describe("Userlike", () => {
    const entity = userlike;
    has("login", () => entity.login());
    has("url", () => entity.url());
  });

  describe("entity", () => {
    it("works for repo", () => {
      expect(view.entity(repo.address())).toEqual(repo);
    });
    it("works for issue", () => {
      expect(view.entity(issue.address())).toEqual(issue);
    });
    it("works for pull", () => {
      expect(view.entity(pull.address())).toEqual(pull);
    });
    it("works for review", () => {
      expect(view.entity(review.address())).toEqual(review);
    });
    it("works for comment", () => {
      expect(view.entity(comment.address())).toEqual(comment);
    });
    it("works for userlike", () => {
      expect(view.entity(userlike.address())).toEqual(userlike);
    });
    it("returns undefined on nonexistent address", () => {
      expect(
        view.entity({type: "REPO", owner: "foo", name: "bar"})
      ).not.toEqual(expect.anything());
    });
    it("errors for bad address type", () => {
      // $ExpectFlowError
      expect(() => view.entity({type: "BAD"})).toThrow("address type");
    });
  });

  describe("match", () => {
    const handlers = {
      // Return the address so we know it was actually called on the entity,
      // and a hardcoded string so we know the right function was called.
      repo: (x: R.Repo) => [x.address(), "REPO"],
      issue: (x: R.Issue) => [x.address(), "ISSUE"],
      pull: (x: R.Pull) => [x.address(), "PULL"],
      review: (x: R.Review) => [x.address(), "REVIEW"],
      comment: (x: R.Comment) => [x.address(), "COMMENT"],
      userlike: (x: R.Userlike) => [x.address(), "USERLIKE"],
    };

    const instances = [repo, issue, pull, review, comment, userlike];
    for (const instance of instances) {
      const [actualAddress, functionType] = R.match(handlers, instance);
      expect(actualAddress.type).toEqual(functionType);
    }
  });

  describe("comment parent differentiation", () => {
    function hasCorrectParent(name, parent) {
      it(name, () => {
        const comment = Array.from(parent.comments())[0];
        expect(comment).toEqual(expect.anything());
        const actualParent = comment.parent();
        expect(parent.address()).toEqual(actualParent.address());
      });
    }
    hasCorrectParent("issue", issue);
    hasCorrectParent("pull", pull);
    hasCorrectParent("review", review);
  });

  it("paired with edges", () => {
    const issue10 = Array.from(view.issues()).find((x) => x.number() === "10");
    if (issue10 == null) {
      throw new Error(`Unable to find issue #10`);
    }
    expect(Array.from(issue10.authors()).map((x) => x.login())).toEqual([
      "decentralion",
      "wchargin",
    ]);
  });

  describe("reference detection", () => {
    // create url->url reference maps, for convenient snapshot readability
    const allReferences: Map<string, Set<string>> = new Map();
    let nReferences = 0;
    for (const referrer of view.textContentEntities()) {
      const references = new Set();
      allReferences.set(referrer.url(), references);
      for (const referenced of referrer.references()) {
        references.add(referenced.url());
        nReferences++;
      }
    }

    it("references match snapshot", () => {
      const everyReference = [];
      for (const [referrerUrl, referencedUrls] of allReferences) {
        for (const referencedUrl of referencedUrls) {
          everyReference.push({from: referrerUrl, to: referencedUrl});
        }
      }
      expect(everyReference).toMatchSnapshot();
    });

    it("correspondence between references() and referencedBy()", () => {
      let nFoundReferences = 0;
      for (const referent of view.referentEntities()) {
        for (const referrer of referent.referencedBy()) {
          nFoundReferences++;
          const srcUrl = referrer.url();
          const dstUrl = referent.url();
          const actualRefsFromSrc = allReferences.get(srcUrl);
          if (actualRefsFromSrc == null) {
            throw new Error(`Expected refs for ${srcUrl}`);
          }
          if (!actualRefsFromSrc.has(dstUrl)) {
            throw new Error(`Expected ref from ${srcUrl} to ${dstUrl}`);
          }
        }
      }
      expect(nFoundReferences).toEqual(nReferences);
    });
  });

  it("addData is idempotent", () => {
    const rv1 = new R.RelationalView();
    rv1.addData(exampleData());
    const rv2 = new R.RelationalView();
    rv2.addData(exampleData());
    rv2.addData(exampleData());
    // may be fragile
    expect(rv1).toEqual(rv2);
  });

  describe("to/fromJSON", () => {
    it("to->from->to is identity", () => {
      const json1 = view.toJSON();
      const view1 = R.RelationalView.fromJSON(json1);
      const json2 = view1.toJSON();
      expect(json1).toEqual(json2);
    });
  });
});
