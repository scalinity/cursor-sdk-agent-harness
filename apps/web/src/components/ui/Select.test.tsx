import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Select, type SelectOption } from "./Select.js";

type Fruit = "apple" | "banana" | "cherry";

const OPTIONS: ReadonlyArray<SelectOption<Fruit>> = [
  { value: "apple", label: "Apple" },
  { value: "banana", label: "Banana" },
  { value: "cherry", label: "Cherry" },
];

afterEach(() => cleanup());

describe("Select", () => {
  it("renders the selected option's label on the trigger", () => {
    render(<Select value="banana" options={OPTIONS} onChange={vi.fn()} />);
    expect(screen.getByRole("button").textContent).toContain("Banana");
  });

  it("prefers triggerLabel over the option label when provided", () => {
    render(
      <Select value="apple" options={OPTIONS} onChange={vi.fn()} triggerLabel="Custom" />,
    );
    expect(screen.getByRole("button").textContent).toContain("Custom");
  });

  it("opens the listbox on click and lists every option", () => {
    render(<Select value="apple" options={OPTIONS} onChange={vi.fn()} />);
    expect(screen.queryByRole("listbox")).toBeNull();
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByRole("listbox")).not.toBeNull();
    expect(screen.getAllByRole("option")).toHaveLength(3);
  });

  it("calls onChange with the chosen value and closes the menu", () => {
    const onChange = vi.fn();
    render(<Select value="apple" options={OPTIONS} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button"));
    fireEvent.click(screen.getByRole("option", { name: "Cherry" }));
    expect(onChange).toHaveBeenCalledWith("cherry");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("navigates with the keyboard and commits on Enter", () => {
    const onChange = vi.fn();
    render(<Select value="apple" options={OPTIONS} onChange={onChange} />);
    const button = screen.getByRole("button");
    // First ArrowDown opens with the selected option active (apple, index 0).
    fireEvent.keyDown(button, { key: "ArrowDown" });
    // Second ArrowDown moves to banana (index 1).
    fireEvent.keyDown(button, { key: "ArrowDown" });
    fireEvent.keyDown(button, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith("banana");
  });

  it("does not open or change when disabled", () => {
    const onChange = vi.fn();
    render(<Select value="apple" options={OPTIONS} onChange={onChange} disabled />);
    fireEvent.click(screen.getByRole("button"));
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("skips disabled options during keyboard navigation", () => {
    const onChange = vi.fn();
    const opts: ReadonlyArray<SelectOption<Fruit>> = [
      { value: "apple", label: "Apple" },
      { value: "banana", label: "Banana", disabled: true },
      { value: "cherry", label: "Cherry" },
    ];
    render(<Select value="apple" options={opts} onChange={onChange} />);
    const button = screen.getByRole("button");
    fireEvent.keyDown(button, { key: "ArrowDown" }); // open, active = apple (0)
    fireEvent.keyDown(button, { key: "ArrowDown" }); // skip disabled banana → cherry (2)
    fireEvent.keyDown(button, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith("cherry");
  });

  it("closes on Escape without selecting", () => {
    const onChange = vi.fn();
    render(<Select value="apple" options={OPTIONS} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button"));
    fireEvent.keyDown(screen.getByRole("button"), { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });
});
