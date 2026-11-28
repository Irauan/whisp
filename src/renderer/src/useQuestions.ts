import { useCallback, useEffect, useReducer } from 'react'
import { answerQuestion, type Answer } from '../../features/repositories/answer-question/answer-question.contract'
import { listQuestions, QUESTIONS_CHANGED, questionEventSchema, type Question } from '../../features/repositories/list-questions/list-questions.contract'
import { invokeContract } from './invoke'
import { emptyQuestionsState, reduceQuestions } from './question-view'

/**
 * The open questions of the main process: the trust question and the directory questions. The hook
 * subscribes first, then loads a snapshot, and loads a new one when it sees a gap in the revisions
 * (decision 0002). The renderer only shows a question and sends one answer. The main process decides what the answer means.
 */
export function useQuestions(): { questions: Question[]; answer(question: Question, answer: Answer): void } {
  const [state, dispatch] = useReducer(reduceQuestions, emptyQuestionsState)

  const load = useCallback(async () => {
    const result = await invokeContract(listQuestions, {})
    if (result.ok) dispatch({ type: 'snapshot', snapshot: result.value })
  }, [])

  useEffect(() => {
    const stop = window.aether.subscribe(QUESTIONS_CHANGED, (payload) => {
      const event = questionEventSchema.safeParse(payload)
      if (event.success) dispatch({ type: 'event', event: event.data })
    })
    void load()
    return stop
  }, [load])

  useEffect(() => {
    if (state.needsSnapshot) void load()
  }, [state.needsSnapshot, load])

  const answer = useCallback(
    (question: Question, value: Answer) => {
      // An answer for a question that closed already comes back as an error. A new snapshot shows the truth.
      void invokeContract(answerQuestion, { sessionId: question.sessionId, questionId: question.id, answer: value }).then((result) => {
        if (!result.ok) void load()
      })
    },
    [load]
  )

  return { questions: state.questions, answer }
}
