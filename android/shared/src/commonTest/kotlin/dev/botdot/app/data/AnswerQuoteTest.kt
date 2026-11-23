package dev.botdot.app.data

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** The question a quick answer shows, from the table every app is checked against (test/fixtures/answer-question-cases.json). */
class AnswerQuoteTest {
    @Serializable
    data class Case(val name: String, val text: String? = null, val questions: List<String>? = null, val question: String)

    @Serializable
    data class Fold(val name: String, val paragraphs: List<String>, val kept: List<Int>)

    @Serializable
    data class Table(val questions: List<Case>, val folds: List<Fold>, val about: JsonElement? = null)

    private val table: Table = Json { ignoreUnknownKeys = true }.decodeFromString(Table.serializer(), fixture("answerQuestions"))

    @Test fun theQuestionOfAReply() {
        assertTrue(table.questions.isNotEmpty())
        table.questions.forEach { c -> assertEquals(c.question, AnswerQuote.questionOf(c.text, c.questions), c.name) }
    }

    @Test fun theParagraphThatStaysWhenAReplyFolds() {
        assertTrue(table.folds.isNotEmpty())
        table.folds.forEach { c -> assertEquals(c.kept, listOf(0, AnswerQuote.questionParagraph(c.paragraphs)).distinct(), c.name) }
    }

    private val asked = Run(id = "q", botId = "iw", status = "success", result = "Done.\n\nShould I post both?", choices = listOf("Post both", "Wait"))
    private fun answer(id: String = "a", prompt: String = "Wait", answers: String? = "q") = Run(id = id, botId = "iw", status = "success", prompt = prompt, answers = answers)

    @Test fun anAnswerQuotesTheQuestionOfItsReply() {
        assertEquals(AnswerQuote.Quote("q", "Should I post both?"), AnswerQuote.of(answer(), mapOf("q" to asked), emptySet()))
    }

    @Test fun noQuoteWhenTheReplyStandsRightAboveIt() {
        assertNull(AnswerQuote.of(answer(), mapOf("q" to asked), setOf("q")))
    }

    @Test fun noQuoteForACardOfQuestionsAMessageThatAnswersNothingOrAReplyTheChatDoesNotHold() {
        assertNull(AnswerQuote.of(answer(prompt = "Which one?\n→ Wait"), mapOf("q" to asked), emptySet()))
        assertNull(AnswerQuote.of(answer(answers = null), mapOf("q" to asked), emptySet()))
        assertNull(AnswerQuote.of(answer(), emptyMap(), emptySet()))
    }

    private fun long(t: String) = t + " x".repeat(130)

    @Test fun aLongReplyThatAskedAndWasAnsweredFoldsButKeepsItsQuestion() {
        val text = listOf(long("First."), long("Middle."), long("Should I post both?"), long("Last.")).joinToString("\n\n")
        assertEquals(listOf(long("First."), long("Should I post both?")).joinToString("\n\n"), RunSteps.folded(text, asks = false, asked = true))
        assertEquals(long("First."), RunSteps.folded(text))
        assertNull(RunSteps.folded(text, asks = true), "a reply that asks now is never folded")
    }
}
