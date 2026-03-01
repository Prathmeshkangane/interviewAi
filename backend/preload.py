# backend/preload.py
import os
from huggingface_hub import hf_hub_download
from transformers import DistilBertModel, DistilBertTokenizer

print("Downloading DistilBERT...")
DistilBertModel.from_pretrained("distilbert-base-uncased", cache_dir="./bert_cache")
DistilBertTokenizer.from_pretrained("distilbert-base-uncased", cache_dir="./bert_cache")
print("DistilBERT saved to ./bert_cache")

print("Downloading model weights...")
hf_hub_download(
    repo_id="Prathmesh0001/interview-AI",
    filename="question_classifier.pt",
    local_dir=".",
    token=os.getenv("HF_TOKEN")
)

os.makedirs("question_tokenizer", exist_ok=True)
hf_hub_download(repo_id="Prathmesh0001/interview-AI", filename="question_tokenizer/tokenizer.json", local_dir=".", token=os.getenv("HF_TOKEN"))
hf_hub_download(repo_id="Prathmesh0001/interview-AI", filename="question_tokenizer/tokenizer_config.json", local_dir=".", token=os.getenv("HF_TOKEN"))
print("All files ready!")