"""Extract final BERT hidden states from the pinned RuBERT-tiny ONNX export.

Requires onnx (offline build tooling only). Does not train or download anything.
Run once for model.onnx and once for model_quantized.onnx; keep tokenizer files.
"""

import argparse
import hashlib
from pathlib import Path

import onnx
from onnx import TensorProto, helper
from onnx.utils import Extractor

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('source', type=Path)
parser.add_argument('destination', type=Path)
args = parser.parse_args()

expected = {
    'f2a259591d0ceaab5d8dcf856a33ee9ca08559c506cb7ee8dca91913cb0b7bde',
    'b57b049fbe8a567203f86b8172b56df1c8c74d1900827ed665ee2efa649c0774',
}
digest = hashlib.sha256(args.source.read_bytes()).hexdigest()
if digest not in expected:
    raise ValueError('Unexpected source: only the checked pinned revision is supported')
model = onnx.load(args.source)
hidden = '/bert/encoder/layer.2/output/LayerNorm/Add_1_output_0'
if not any(hidden in node.output for node in model.graph.node):
    raise ValueError('Expected final encoder LayerNorm output is missing')
model.graph.node.append(helper.make_node('Identity', [hidden], ['last_hidden_state']))
del model.graph.output[:]
model.graph.output.append(helper.make_tensor_value_info(
    'last_hidden_state', TensorProto.FLOAT, ['batch_size', 'sequence_length', 312]
))
extracted = Extractor(model).extract_model(
    [value.name for value in model.graph.input], ['last_hidden_state']
)
onnx.checker.check_model(extracted)
args.destination.parent.mkdir(parents=True, exist_ok=True)
onnx.save(extracted, args.destination)
print(f'{args.destination}: {args.destination.stat().st_size} bytes; '
      f'sha256={hashlib.sha256(args.destination.read_bytes()).hexdigest()}')
