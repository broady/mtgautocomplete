package main

import (
	"strings"

	"github.com/tchap/go-patricia/patricia"
)

var model = patricia.NewTrie()

func populate(cards []string) {
	prefixes := make(map[string][]string)
	for _, cn := range cards {
		fields := strings.Fields(cn)
		for i := range fields {
			prefix := strings.ToLower(strings.Join(fields[i:len(fields)], " "))
			results := prefixes[prefix]
			if results == nil {
				results = make([]string, 0)
			} else {
				model.Delete(patricia.Prefix(prefix))
			}
			results = append(results, cn)
			prefixes[prefix] = results
			model.Insert(patricia.Prefix(prefix), results)
		}
	}
}

func suggestion(s string) []string {
	suggestions := make([]string, 0)
	model.VisitSubtree(patricia.Prefix(strings.ToLower(s)), func(prefix patricia.Prefix, item patricia.Item) error {
		results := item.([]string)
		for _, result := range results {
			suggestions = append(suggestions, result)
		}
		return nil
	})
	return suggestions
}
