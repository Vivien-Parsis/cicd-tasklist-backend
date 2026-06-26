import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { vi } from "vitest";
import testPrisma from "./setup.js";

vi.mock("../../lib/prisma.js", () => ({
	default: testPrisma
}));

const { default: app } = await import("../../app.js");
import request from "supertest";

async function seedTask(
	overrides: {
		title?: string;
		description?: string | null;
		completed?: boolean;
		createdAt?: Date;
	} = {}
) {
	return testPrisma.task.create({
		data: {
			title: "Seed Task",
			description: "Seed description",
			completed: false,
			...overrides
		}
	});
}

describe("Task API E2E Tests", () => {
	beforeEach(async () => {
		// Clean up database between tests
		await testPrisma.task.deleteMany();
	});

	afterAll(async () => {
		await testPrisma.$disconnect();
	});

	describe("POST /api/tasks", () => {
		it("should create a new task", async () => {
			const res = await request(app)
				.post("/api/tasks")
				.send({ title: "E2E Task", description: "E2E Description" });

			expect(res.status).toBe(201);
			expect(res.body).toHaveProperty("id");
			expect(res.body.title).toBe("E2E Task");
			expect(res.body.description).toBe("E2E Description");
			expect(res.body.completed).toBe(false);
		});

		it("should create a task without a description", async () => {
			const res = await request(app)
				.post("/api/tasks")
				.send({ title: "No description" });

			expect(res.status).toBe(201);
			expect(res.body.title).toBe("No description");
			expect(res.body.description).toBeNull();
		});

		it("should trim the title before saving", async () => {
			const res = await request(app)
				.post("/api/tasks")
				.send({ title: "  Trimmed  " });

			expect(res.status).toBe(201);
			expect(res.body.title).toBe("Trimmed");
		});

		it("should return 400 when the title is missing", async () => {
			const res = await request(app).post("/api/tasks").send({});

			expect(res.status).toBe(400);
			expect(res.body).toHaveProperty("error");
		});

		it("should return 400 when the title is only whitespace", async () => {
			const res = await request(app)
				.post("/api/tasks")
				.send({ title: "   " });

			expect(res.status).toBe(400);
		});

		it("should return 400 when the title is not a string", async () => {
			const res = await request(app)
				.post("/api/tasks")
				.send({ title: 123 });

			expect(res.status).toBe(400);
		});
	});

	describe("GET /api/tasks", () => {
		it("should return an empty array when there are no tasks", async () => {
			const res = await request(app).get("/api/tasks");

			expect(res.status).toBe(200);
			expect(res.body).toEqual([]);
		});

		it("should return all tasks ordered by createdAt desc", async () => {
			await seedTask({
				title: "Older",
				createdAt: new Date("2026-01-01T00:00:00.000Z")
			});
			await seedTask({
				title: "Newer",
				createdAt: new Date("2026-02-01T00:00:00.000Z")
			});

			const res = await request(app).get("/api/tasks");

			expect(res.status).toBe(200);
			expect(res.body).toHaveLength(2);
			expect(res.body[0].title).toBe("Newer");
			expect(res.body[1].title).toBe("Older");
		});
	});

	describe("GET /api/tasks/:id", () => {
		it("should return the task when it exists", async () => {
			const task = await seedTask({ title: "Find me" });

			const res = await request(app).get(`/api/tasks/${task.id}`);

			expect(res.status).toBe(200);
			expect(res.body.id).toBe(task.id);
			expect(res.body.title).toBe("Find me");
		});

		it("should return 404 when the task does not exist", async () => {
			const res = await request(app).get("/api/tasks/999999");

			expect(res.status).toBe(404);
			expect(res.body).toHaveProperty("error");
		});

		it("should return 400 when the id is not numeric", async () => {
			const res = await request(app).get("/api/tasks/abc");

			expect(res.status).toBe(400);
			expect(res.body).toHaveProperty("error");
		});
	});

	describe("PUT /api/tasks/:id", () => {
		it("should update an existing task", async () => {
			const task = await seedTask({ title: "Before", completed: false });

			const res = await request(app)
				.put(`/api/tasks/${task.id}`)
				.send({ title: "After", completed: true });

			expect(res.status).toBe(200);
			expect(res.body.title).toBe("After");
			expect(res.body.completed).toBe(true);
		});

		it("should return 404 when updating a non-existent task", async () => {
			const res = await request(app)
				.put("/api/tasks/999999")
				.send({ title: "Nope" });

			expect(res.status).toBe(404);
			expect(res.body).toHaveProperty("error");
		});

		it("should return 400 when the id is not numeric", async () => {
			const res = await request(app)
				.put("/api/tasks/abc")
				.send({ title: "Nope" });

			expect(res.status).toBe(400);
		});
	});

	describe("DELETE /api/tasks/:id", () => {
		it("should delete an existing task and return 204", async () => {
			const task = await seedTask();

			const res = await request(app).delete(`/api/tasks/${task.id}`);

			expect(res.status).toBe(204);
			expect(res.body).toEqual({});

			const check = await request(app).get(`/api/tasks/${task.id}`);
			expect(check.status).toBe(404);
		});

		it("should return 404 when deleting a non-existent task", async () => {
			const res = await request(app).delete("/api/tasks/999999");

			expect(res.status).toBe(404);
			expect(res.body).toHaveProperty("error");
		});

		it("should return 400 when the id is not numeric", async () => {
			const res = await request(app).delete("/api/tasks/abc");

			expect(res.status).toBe(400);
		});
	});
});
