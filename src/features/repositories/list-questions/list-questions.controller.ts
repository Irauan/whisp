import { ok } from '../../../building-blocks/result'
import type { Questions } from '../questions.store'

/** The input is already parsed against the contract. */
export const listQuestionsController = (questions: Questions) => async () => ok(questions.snapshot())
