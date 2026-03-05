from huggingface_hub import HfApi
import os

token = os.getenv("HF_TOKEN")
api = HfApi()


# Upload model
api.upload_file(
    path_or_fileobj='backend/question_classifier.pt',
    path_in_repo='question_classifier.pt',
    repo_id='Prathmesh0001/interview-AI',
    repo_type='model',
    token=token
)
print('Model uploaded!')

# Upload tokenizer files
tokenizer_folder = 'backend/question_tokenizer'
for filename in os.listdir(tokenizer_folder):
    api.upload_file(
        path_or_fileobj=f'{tokenizer_folder}/{filename}',
        path_in_repo=f'question_tokenizer/{filename}',
        repo_id='Prathmesh0001/interview-AI',
        repo_type='model',
        token=token
    )
    print(f'Uploaded tokenizer/{filename}')

print('All done!')