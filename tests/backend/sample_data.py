"""Shared test interaction dataset for WDAIDT.

Covers various interaction types specified in the testing blueprint:
- Recommendation questions
- Ambiguous questions
- Simple factual questions
- Missing context / follow-ups
- Code-heavy interactions
- Non-English interactions
"""

SAMPLE_INTERACTIONS = [
    {
        "name": "recommendation",
        "prompt": "Should I learn Python or Java for AI?",
        "response": (
            "Python is generally recommended for AI because of its extensive ecosystem "
            "of specialized libraries like PyTorch, TensorFlow, and scikit-learn, along "
            "with a very active research community."
        ),
        "request_id": "test-req-rec-001",
    },
    {
        "name": "ambiguous",
        "prompt": "How do I fix it?",
        "response": (
            "To help you fix the issue, I will need a bit more information. What error "
            "message are you encountering, and what technology or code are you working with?"
        ),
        "request_id": "test-req-amb-002",
    },
    {
        "name": "simple_factual",
        "prompt": "What is the capital of France?",
        "response": "The capital of France is Paris.",
        "request_id": "test-req-simple-003",
    },
    {
        "name": "missing_info_followup",
        "prompt": "Why did that happen in step 2?",
        "response": (
            "Assuming you are referring to the database migration step discussed earlier, "
            "step 2 failed because the foreign key constraint was evaluated before the parent "
            "table was populated."
        ),
        "request_id": "test-req-followup-004",
    },
    {
        "name": "code_heavy",
        "prompt": (
            "def calculate(items):\n"
            "    res = []\n"
            "    for x in items:\n"
            "        res.append(x * 2)\n"
            "    return res\n\n"
            "How can I write this more pythonically?"
        ),
        "response": (
            "You can rewrite this concisely using a list comprehension:\n\n"
            "```python\n"
            "def calculate(items):\n"
            "    return [x * 2 for x in items]\n"
            "```\n\n"
            "This is more readable and slightly faster in standard CPython."
        ),
        "request_id": "test-req-code-005",
    },
    {
        "name": "non_english",
        "prompt": "¿Debería usar React o Vue para mi próximo proyecto web?",
        "response": (
            "React es una excelente opción si buscas un gran ecosistema y muchas oportunidades "
            "laborales, mientras que Vue destaca por su curva de aprendizaje suave e integración sencilla."
        ),
        "request_id": "test-req-lang-006",
    },
]
