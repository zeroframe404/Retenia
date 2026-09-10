/**
 * The two model lessons `P3_write_lesson` tells the model it has.
 *
 * They live here rather than in the prompt file because they belong to the *cached prefix*,
 * not to the instructions: `loadPrompt` reads one `<version>.md` and hashes it into every
 * `custom_id`, so growing the file by two full lessons would invalidate every cached answer
 * on any wording change to either example. As a separate constant they are byte-stable,
 * versioned with this package, and cheap to revise.
 *
 * They are deliberately short and deliberately about nothing in the corpus: the model is
 * asked to copy the register and the block order, never the subject matter. Between them they
 * show every rule that is hard to state in prose — an `[cite:...]` marker sitting at the end
 * of the sentence it supports rather than at the end of the paragraph, a `general_knowledge`
 * block carrying a definition the sources did not contain, a `misconception` block naming the
 * wrong belief before correcting it, and a `diagram` whose `alt_text` says what the diagram
 * shows rather than that it is a diagram.
 */

export const LESSON_FEW_SHOT_A = `### Ejemplo 1 — "Por qué el índice acelera una búsqueda"

hook: Una consulta que tardaba nueve segundos pasó a tardar cuatro milisegundos sin cambiar
una sola línea de SQL. Lo único que cambió fue dónde estaba escrita la respuesta.

activation_question: ¿Cuántas filas creés que tiene que mirar la base para encontrar una,
si no sabe dónde está?

explanation: Sin un índice, el motor recorre la tabla entera y compara fila por fila; el
costo crece con el tamaño de la tabla [cite:B02]. Un índice guarda las claves ordenadas en
una estructura de árbol, de modo que cada comparación descarta la mitad de lo que queda
[cite:B02]. Por eso el costo pasa de crecer con n a crecer con el logaritmo de n [cite:B03].

worked_example: Una tabla de 1.000.000 de filas exige hasta 1.000.000 de comparaciones sin
índice. Con un árbol balanceado son unas 20, porque 2^20 ya supera el millón [cite:B03].

misconception: Es común pensar que "más índices, más rápido". No: cada índice hay que
mantenerlo en cada INSERT y en cada UPDATE de la columna que indexa, así que un índice que
ninguna consulta usa sólo cuesta [cite:B05].

summary: Un índice cambia el costo de buscar de lineal a logarítmico, y lo paga escribiendo.`

export const LESSON_FEW_SHOT_B = `### Ejemplo 2 — "El intervalo entre repasos"

hook: Estudiar dos veces seguidas se siente productivo y casi no deja nada. Separar esas dos
sesiones por un día deja bastante más, con el mismo tiempo total.

explanation: La retención cae con el tiempo desde el último repaso, y cada repaso exitoso
aplana esa caída [cite:B11]. El efecto depende de *cuándo* se repasa: repasar cuando el
recuerdo todavía está fresco casi no mueve la curva [cite:B12].

general_knowledge: "Curva del olvido" es el nombre que se le da al gráfico de retención
contra tiempo. El término no aparece en tus fuentes; lo usamos acá porque es como se lo
conoce.

diagram (mermaid, alt_text: "La retención cae después de cada repaso, y cae más lento tras
cada uno"): un gráfico de líneas con tres tramos descendentes, cada uno menos inclinado que
el anterior.

summary: Repasar cuesta lo mismo cerca o lejos; lejos rinde más.`

/** The prefix section, assembled once. Order is meaning: the provider matches bytes. */
export const LESSON_FEW_SHOTS = `${LESSON_FEW_SHOT_A}\n\n${LESSON_FEW_SHOT_B}`
