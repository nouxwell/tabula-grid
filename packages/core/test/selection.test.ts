import { describe, expect, it } from "vitest"
import { Selection, TabulaError, type Direction } from "../src/index"

describe("Selection", () => {
	it("starts on the first cell", () => {
		const selection = new Selection(10, 5)

		expect(selection.active).toEqual({ row: 0, col: 0 })
		expect(selection.range).toEqual({ top: 0, left: 0, bottom: 0, right: 0 })
	})

	it("has no active cell in a grid without cells, and ignores moves there", () => {
		const selection = new Selection(0, 5)

		selection.move(1, 1)
		selection.selectAll()

		expect(selection.active).toBeNull()
		expect(selection.range).toBeNull()
		expect(selection.contains(0, 0)).toBe(false)
	})

	it("stays inside the grid", () => {
		const selection = new Selection(10, 5)

		selection.move(-1, -1)
		expect(selection.active).toEqual({ row: 0, col: 0 })

		selection.moveTo(Infinity, Infinity)
		expect(selection.active).toEqual({ row: 9, col: 4 })

		selection.move(3, 0)
		expect(selection.active).toEqual({ row: 9, col: 4 })
	})

	it("extends from the active cell without moving it, as Shift does", () => {
		const selection = new Selection(10, 5)

		selection.moveTo(2, 2)
		selection.move(1, 1, { extend: true })

		expect(selection.active).toEqual({ row: 2, col: 2 })
		expect(selection.head).toEqual({ row: 3, col: 3 })
		expect(selection.range).toEqual({ top: 2, left: 2, bottom: 3, right: 3 })

		selection.move(-3, -3, { extend: true })

		expect(selection.active).toEqual({ row: 2, col: 2 })
		expect(selection.range).toEqual({ top: 0, left: 0, bottom: 2, right: 2 })
		expect(selection.contains(1, 1)).toBe(true)
		expect(selection.contains(3, 3)).toBe(false)
	})

	it("collapses onto one cell on a plain move", () => {
		const selection = new Selection(10, 5)

		selection.moveTo(2, 2)
		selection.move(2, 2, { extend: true })
		selection.move(0, 1)

		expect(selection.active).toEqual({ row: 2, col: 3 })
		expect(selection.range).toEqual({ top: 2, left: 3, bottom: 2, right: 3 })
	})

	it("selects whole rows and whole columns", () => {
		const selection = new Selection(10, 5)

		selection.selectRows(4, 2)
		expect(selection.range).toEqual({ top: 2, left: 0, bottom: 4, right: 4 })
		expect(selection.active).toEqual({ row: 4, col: 0 })

		selection.selectColumns(1)
		expect(selection.range).toEqual({ top: 0, left: 1, bottom: 9, right: 1 })
		expect(selection.active).toEqual({ row: 0, col: 1 })
	})

	it("selects everything without moving the active cell", () => {
		const selection = new Selection(10, 5)

		selection.moveTo(3, 3)
		selection.selectAll()

		expect(selection.active).toEqual({ row: 3, col: 3 })
		expect(selection.range).toEqual({ top: 0, left: 0, bottom: 9, right: 4 })
	})

	it("keeps the active cell selected when the selection shrinks past it", () => {
		const selection = new Selection(5, 5)

		selection.moveTo(3, 3)
		selection.selectAll()
		selection.move(-4, -4, { extend: true })

		expect(selection.range).toEqual({ top: 0, left: 0, bottom: 0, right: 0 })
		expect(selection.active).toEqual({ row: 0, col: 0 })
	})

	describe("jump, as Ctrl and an arrow", () => {
		// One column: filled, filled, filled, empty, empty, filled, empty.
		const column = [true, true, true, false, false, true, false]
		const isBlank = (row: number): boolean => !column[row]

		it.each<[number, Direction, number, string]>([
			[0, "down", 2, "inside a run, to its end"],
			[2, "down", 5, "at the end of a run, to the next filled cell"],
			[3, "down", 5, "from an empty cell, to the next filled cell"],
			[5, "down", 6, "with nothing filled ahead, to the edge"],
			[6, "down", 6, "at the edge, nowhere"],
			[6, "up", 5, "from an empty cell upwards, to the next filled cell"],
			[5, "up", 2, "at the start of a run, to the next filled cell above"],
			[2, "up", 0, "inside a run upwards, to its start"]
		])("from row %i %s goes to row %i: %s", (from, direction, to) => {
			const selection = new Selection(column.length, 1)

			selection.moveTo(from, 0)
			selection.jump(direction, isBlank)

			expect(selection.active).toEqual({ row: to, col: 0 })
		})

		it("goes to the edge of an empty column", () => {
			const selection = new Selection(7, 1)

			selection.jump("down", () => true)

			expect(selection.active).toEqual({ row: 6, col: 0 })
		})

		it("moves only the head when extending", () => {
			const selection = new Selection(column.length, 1)

			selection.jump("down", isBlank, { extend: true })

			expect(selection.active).toEqual({ row: 0, col: 0 })
			expect(selection.range).toEqual({ top: 0, left: 0, bottom: 2, right: 0 })
		})
	})

	it("keeps everything inside the grid when the grid shrinks, and starts again when it grows", () => {
		const selection = new Selection(10, 5)

		selection.moveTo(8, 4)
		selection.move(1, 0, { extend: true })
		selection.resize(5, 3)

		expect(selection.active).toEqual({ row: 4, col: 2 })
		expect(selection.range).toEqual({ top: 4, left: 2, bottom: 4, right: 2 })

		selection.resize(0, 3)
		expect(selection.active).toBeNull()

		selection.resize(2, 2)
		expect(selection.active).toEqual({ row: 0, col: 0 })
	})

	it("tells its listeners only when something changed", () => {
		const selection = new Selection(10, 5)
		let calls = 0
		const stop = selection.subscribe(() => calls++)

		selection.move(-1, 0)
		selection.moveTo(0, 0)
		selection.move(1, 0)
		selection.move(1, 0, { extend: true })
		stop()
		selection.move(1, 0)

		expect(calls).toBe(2)
	})

	it("refuses a position that is not a number and a size that is not a count", () => {
		const selection = new Selection(10, 5)

		expect(() => selection.moveTo(Number.NaN, 0)).toThrow(TabulaError)
		expect(() => new Selection(-1, 5)).toThrow(TabulaError)
		expect(() => selection.resize(1.5, 5)).toThrow(TabulaError)
	})
})
