import z from "zod";

export const templateSchema = z.enum([
	"azurill",
	"bronzor",
	"chikorita",
	"ditgar",
	"ditto",
	"gengar",
	"glalie",
	"kakuna",
	"lapras",
	"leafish",
	"meowth",
	"onyx",
	"pikachu",
	"rhyhorn",
	"scizor",
	// Chinese resume template family — appended (not alphabetical) so the
	// already-accepted 15 templates keep their shelf/gallery order.
	"zhuque",
	"qinglong",
	"xuanwu",
]);

export type Template = z.infer<typeof templateSchema>;
