from langchain.chains import LLMChain
from langchain.prompts import PromptTemplate
from langchain_mistralai.chat_models import ChatMistralAI
from dotenv import load_dotenv
load_dotenv()
# Initialize the LLM
model = ChatMistralAI(model="mistral-large-latest", temperature=0.7)

# 1. Greeting Chain
greeting_template = """You are a friendly interviewer. Greet the candidate warmly and ask how they are doing."""
greeting_prompt = PromptTemplate.from_template(greeting_template)
greeting_chain = LLMChain(llm=model, prompt=greeting_prompt)

# 2. Small Talk Chain (for all follow-up small talk)
small_talk_template = """Continue the natural conversation based on the candidate's last response:
Candidate: {last_response}
Respond naturally and keep the conversation going."""
small_talk_prompt = PromptTemplate.from_template(small_talk_template)
small_talk_chain = LLMChain(llm=model, prompt=small_talk_prompt)

# Run the conversation
print("Starting interview...\n")

# Initial greeting
greeting = greeting_chain.run({})
print(f"Interviewer: {greeting}")
user_input = input("Candidate: ")

# Small talk loop (3 exchanges)
for i in range(3):
    small_talk = small_talk_chain.run({"last_response": user_input})
    print(f"\nInterviewer: {small_talk}")
    user_input = input("Candidate: ")

print("\n(Now moving to interview questions...)")