/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const { projectMocks } = vi.hoisted(() => ({
  projectMocks: {
    listProjects: vi.fn(),
    createProject: vi.fn(),
    updateProject: vi.fn(),
    deleteProject: vi.fn(),
  },
}));

vi.mock("../src/sidebar/utils/projectStore", () => ({
  listProjects: projectMocks.listProjects,
  createProject: projectMocks.createProject,
  updateProject: projectMocks.updateProject,
  deleteProject: projectMocks.deleteProject,
}));

import ProjectsView from "../src/sidebar/components/ProjectsView";

describe("ProjectsView DOM interactions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    projectMocks.listProjects.mockResolvedValue([]);
    projectMocks.createProject.mockResolvedValue({});
    projectMocks.updateProject.mockResolvedValue(undefined);
    projectMocks.deleteProject.mockResolvedValue(undefined);
  });

  it("creates a project with parsed URL patterns", async () => {
    render(<ProjectsView />);

    fireEvent.click(await screen.findByText("+ New Project"));

    fireEvent.change(
      screen.getByPlaceholderText("Project name (e.g. Work — Jira)"),
      {
        target: { value: "Work" },
      },
    );

    fireEvent.change(screen.getByPlaceholderText(/URL patterns/), {
      target: { value: "*github.com*\n*jira.*" },
    });

    fireEvent.change(
      screen.getByPlaceholderText(
        "Custom instructions for the AI when on matching pages...",
      ),
      {
        target: { value: "Focus on tickets" },
      },
    );

    fireEvent.click(screen.getByText("Create Project"));

    await waitFor(() => {
      expect(projectMocks.createProject).toHaveBeenCalledWith(
        "Work",
        ["*github.com*", "*jira.*"],
        "Focus on tickets",
        "📁",
      );
    });
  });

  it("deletes an existing project", async () => {
    projectMocks.listProjects.mockResolvedValue([
      {
        id: "p1",
        name: "Existing",
        icon: "📁",
        urlPatterns: ["*github.com*"],
        instructions: "Keep concise",
        isActive: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    ]);

    render(<ProjectsView />);

    const deleteButton = await screen.findByTitle("Delete");
    fireEvent.click(deleteButton);

    await waitFor(() => {
      expect(projectMocks.deleteProject).toHaveBeenCalledWith("p1");
    });
  });
});
