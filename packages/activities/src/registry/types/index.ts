/**
 * Importing this module registers the 21 MVP types of `docs/spec/03-activities.md` §6 — one file
 * per type, as §9 requires ("adding a type = one file + one prompt + fixtures"). The other 77 rows
 * of the master table register themselves the same way in phases 2 and 3.
 *
 * The imports are side-effecting: each file calls `defineActivityType` at module scope, so the
 * registry is populated by the time `@retenia/activities` has finished loading. They are listed in
 * master-table order, which is the order `registeredActivityTypes()` reports.
 */
import './flashcard_basic'
import './flashcard_reverse'
import './dialog_cards'
import './cloze_typed'
import './short_answer'
import './numeric_answer'
import './free_recall'
import './mcq_single'
import './mcq_multi'
import './true_false'
import './statement_set'
import './cloze_dropdown'
import './cloze_wordbank'
import './mark_the_words'
import './matching_pairs'
import './ordering_sequence'
import './categorize'
import './sentence_builder'
import './complete_the_chat'
import './essay_rubric'
import './disclosure_block'
