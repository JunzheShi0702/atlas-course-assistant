import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import programListRouter from "./program-list";

function makeApp() {
  const app = express();
  app.use("/api", programListRouter);
  return app;
}

describe("GET /api/program-list", () => {
  it("returns the public onboarding program catalog", async () => {
    const res = await request(makeApp()).get("/api/program-list");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      schoolNa: expect.any(String),
      kriegerSchoolLabel: expect.any(String),
      whitingSchoolLabel: expect.any(String),
      programs: expect.any(Array),
    });
    expect(res.body.programs.length).toBeGreaterThan(0);
    expect(res.body.programs[0]).toEqual(
      expect.objectContaining({
        name: expect.any(String),
        hasMajor: expect.any(Boolean),
        hasMinor: expect.any(Boolean),
      }),
    );
  });
});
