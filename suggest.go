package main

import (
	"strings"

	"github.com/tchap/go-patricia/patricia"
)

var model = patricia.NewTrie()

func populate(cards []string) {
	for _, cn := range cards {
		fields := strings.Fields(cn)
		for i := range fields {
			prefix := strings.Join(fields[i:len(fields)], " ")
			model.Insert(patricia.Prefix(strings.ToLower(prefix)), cn)
		}
	}
}

func suggestion(s string) []string {
	suggestions := make([]string, 0)
	model.VisitSubtree(patricia.Prefix(strings.ToLower(s)), func(prefix patricia.Prefix, item patricia.Item) error {
		suggestions = append(suggestions, item.(string))
		return nil
	})
	return suggestions
}
